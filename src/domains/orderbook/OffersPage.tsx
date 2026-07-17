import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Download,
  Lock,
  RefreshCw,
  Repeat2,
  WifiOff,
  X
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { useOrderbookStore } from "@/domains/orderbook/orderbookStore";
import { resetNostrOrderbookSession, subscribeNostrOrderbook } from "@/domains/orderbook/nostrOrderbook";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { filterPublicOrders } from "@/domains/orderbook/orderbookFilters";
import { buildTakeOfferPayload, defaultTakeAmount, validateTakeOffer } from "@/domains/orderbook/takeOffer";
import { getRobotAuthForCoordinator, useGarageStore } from "@/domains/garage/garageStore";
import { downloadRobotTokenBackup } from "@/domains/garage/tokenBackup";
import { fetchOrder, submitOrderAction } from "@/domains/orders/orderApi";
import { roleBuysBitcoin, roleIntentLabel } from "@/domains/orders/orderRole";
import type { OrderDto } from "@/domains/orders/order.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/infoHint";
import { Skeleton } from "@/components/ui/skeleton";
import { CurrencyFlag, CurrencyPicker, IntentPicker, PaymentMethodIcons, PaymentMethodPicker, type IntentPickerOption } from "@/domains/orderbook/OfferMeta";
import { isSwapPaymentMethod, matchedPaymentMethods, paymentIconSrc, paymentMethodOptions } from "@/domains/orderbook/paymentMethods";
import { bondDisplayValue, expiryRingValue, formatExpiryTitle, knownSatsValue, orderSatsPreview } from "@/domains/orderbook/offerDisplay";
import { formatFiat, formatSats } from "@/lib/format";
import { toUserMessage } from "@/lib/userError";

type SortColumn = "amount" | "premium" | "bond" | "expiry";
type SortDirection = "asc" | "desc";
type IntentFilter = "any" | "buy" | "sell" | "swap-in" | "swap-out";

const pageSize = 13;
const intentOptions: IntentPickerOption[] = [
  { label: "ANY", value: "any", tone: "any" },
  { label: "BUY", value: "buy", tone: "buy" },
  { label: "SELL", value: "sell", tone: "sell" },
  { label: "SWAP IN", value: "swap-in", tone: "swap-in" },
  { label: "SWAP OUT", value: "swap-out", tone: "swap-out" }
];
const preloadedPaymentIconUrls = new Set<string>();

export function OffersPage() {
  const navigate = useNavigate();
  const { connection, coordinators, origin, refreshCoordinators } = useFederationStore();
  const { orders, loading, refreshing, error, lastUpdated, refreshOrderbook, applyLiveOrders } = useOrderbookStore();
  const hydrateGarage = useGarageStore((state) => state.hydrate);
  const activeSlot = useGarageStore((state) => state.currentSlot());
  const setActiveOrder = useGarageStore((state) => state.setActiveOrder);
  const [intentFilter, setIntentFilter] = useState<IntentFilter>("any");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [selectedOrderKey, setSelectedOrderKey] = useState<string | null>(null);
  const [takeModalOpen, setTakeModalOpen] = useState(false);
  const [takeAmount, setTakeAmount] = useState("");
  const [offerPassword, setOfferPassword] = useState("");
  const [takeError, setTakeError] = useState<string | undefined>();
  const [taking, setTaking] = useState(false);
  const [confirmTakeOpen, setConfirmTakeOpen] = useState(false);
  const [descriptionConfirmOpen, setDescriptionConfirmOpen] = useState(false);
  const [takeIntentPending, setTakeIntentPending] = useState(false);
  const [privateOrder, setPrivateOrder] = useState<OrderDto | undefined>();
  const [privateOrderLoading, setPrivateOrderLoading] = useState(false);
  const [orderDetailsResolved, setOrderDetailsResolved] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [nostrSessionEpoch, setNostrSessionEpoch] = useState(0);

  async function refresh(force = false) {
    const currentState = useFederationStore.getState();

    if (currentState.connection === "nostr") {
      try {
        await refreshOrderbook(currentState.coordinators, {
          connection: currentState.connection,
          force,
          hostUrl: currentHostUrl(),
          network: currentState.network,
          origin: currentState.origin
        });
      } finally {
        void refreshCoordinators();
      }
      return;
    }

    // Refreshing offers must not fan out into /info and /limits requests for
    // every coordinator. The federation store maintains its own slower TTL.
    await refreshCoordinators();
    const refreshedState = useFederationStore.getState();
    await refreshOrderbook(refreshedState.coordinators, {
      connection: refreshedState.connection,
      force,
        network: refreshedState.network,
        origin: refreshedState.origin
    });
  }

  useEffect(() => {
    hydrateGarage();
    void refresh();
  }, []);

  const coordinatorSubscriptionKey = coordinators
    .filter((coordinator) => coordinator.enabled)
    .map((coordinator) => `${coordinator.shortAlias}:${coordinator.url}:${coordinator.nostrHexPubkey ?? ""}`)
    .join("|");

  useEffect(() => {
    if (connection !== "nostr") return;
    return subscribeNostrOrderbook(coordinators, useFederationStore.getState().network, {
      hostUrl: currentHostUrl(),
      onOrders: (liveOrders, meta) => {
        const state = useFederationStore.getState();
        applyLiveOrders(
          liveOrders,
          "nostr",
          state.network,
          state.origin,
          meta.partial || !meta.authoritative
        );
      }
    });
  }, [applyLiveOrders, connection, coordinatorSubscriptionKey, nostrSessionEpoch, origin]);

  useEffect(() => {
    let refreshTimer: number | undefined;

    const recoverOrderbook = () => {
      if (connection === "nostr") {
        resetNostrOrderbookSession();
        setNostrSessionEpoch((value) => value + 1);
      }
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(true), 150);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (error) {
        recoverOrderbook();
        return;
      }
      void refresh();
    };

    const refreshAfterResume = () => {
      if (error) {
        recoverOrderbook();
        return;
      }
      void refresh();
    };

    window.addEventListener("online", recoverOrderbook);
    window.addEventListener("robosats:tor-reconnected", recoverOrderbook);
    window.addEventListener("robosats:native-resume", refreshAfterResume);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      window.removeEventListener("online", recoverOrderbook);
      window.removeEventListener("robosats:tor-reconnected", recoverOrderbook);
      window.removeEventListener("robosats:native-resume", refreshAfterResume);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [connection, error]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const currencyOptions = useMemo(() => {
    return [...new Set(orders.map((order) => order.currencyCode ?? String(order.currency)).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right)
    );
  }, [orders]);
  const methodOptions = useMemo(() => {
    const present = new Set<string>();

    for (const order of orders) {
      if (!orderMatchesIntent(order, intentFilter)) continue;
      const matches = matchedPaymentMethods(order.payment_method);
      for (const match of matches) {
        if (intentFilter === "any" && isSwapPaymentMethod(match)) continue;
        present.add(match.name);
      }
    }

    return paymentMethodOptions()
      .filter((method) => present.has(method.name))
      .map((method) => ({ icon: method.icon, name: method.name }));
  }, [intentFilter, orders]);

  const filteredOrders = useMemo(() => {
    const baseOrders = filterPublicOrders(orders, { side: "all", coordinator: "all" }).filter((order) => {
      const currency = order.currencyCode ?? String(order.currency);
      if (!orderMatchesIntent(order, intentFilter)) return false;
      if (currencyFilter !== "all" && currency !== currencyFilter) return false;
      if (methodFilter !== "all" && !orderMatchesMethod(order.payment_method, methodFilter)) return false;
      return true;
    });

    if (!sortColumn) return baseOrders;
    return [...baseOrders].sort((left, right) => compareOrders(left, right, sortColumn, sortDirection));
  }, [currencyFilter, intentFilter, methodFilter, orders, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleOrders = useMemo(() => filteredOrders.slice(pageStart, pageStart + pageSize), [filteredOrders, pageStart]);
  const visiblePaymentMethodKey = useMemo(() => visibleOrders.map((order) => order.payment_method).join("|"), [visibleOrders]);
  const selectedOrder = selectedOrderKey ? filteredOrders.find((order) => orderKey(order) === selectedOrderKey) : undefined;
  const selectedCoordinator = selectedOrder
    ? coordinators.find((item) => item.shortAlias === selectedOrder.coordinatorShortAlias)
    : undefined;
  const selectedDescription = (privateOrder?.description || selectedOrder?.description || "").trim();
  const showInitialSkeleton = (loading || refreshing) && orders.length === 0;

  useEffect(() => {
    setPage(1);
  }, [currencyFilter, intentFilter, methodFilter, sortColumn, sortDirection]);

  useEffect(() => {
    if (currencyFilter !== "all" && !currencyOptions.includes(currencyFilter)) setCurrencyFilter("all");
  }, [currencyFilter, currencyOptions]);

  useEffect(() => {
    if (visibleOrders.length === 0 || typeof Image === "undefined") return;

    const urls = new Set<string>();
    for (const order of visibleOrders) {
      for (const method of matchedPaymentMethods(order.payment_method)) {
        const url = paymentIconSrc(method.icon);
        if (!preloadedPaymentIconUrls.has(url)) urls.add(url);
        if (urls.size >= 16) break;
      }
      if (urls.size >= 16) break;
    }

    if (urls.size === 0) return;

    const timer = window.setTimeout(() => {
      for (const url of urls) {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        preloadedPaymentIconUrls.add(url);
      }
    }, 80);

    return () => window.clearTimeout(timer);
  }, [visiblePaymentMethodKey]);

  useEffect(() => {
    if (!selectedOrder) {
      if (takeModalOpen) setTakeModalOpen(false);
      return;
    }

    setTakeAmount(defaultTakeAmount(selectedOrder));
    setOfferPassword("");
    setTakeError(undefined);
  }, [selectedOrder?.coordinatorShortAlias, selectedOrder?.id]);

  useEffect(() => {
    setPrivateOrder(undefined);
    setPrivateOrderLoading(false);
    setOrderDetailsResolved(true);
    if (!takeModalOpen || !selectedOrder || !selectedCoordinator || !activeSlot) return;
    const auth = getRobotAuthForCoordinator(activeSlot, selectedCoordinator.shortAlias);
    if (!auth) return;

    let disposed = false;
    setPrivateOrderLoading(true);
    setOrderDetailsResolved(false);
    void fetchOrder(selectedCoordinator.url, selectedOrder.id, auth)
      .then((order) => {
        if (!disposed) setPrivateOrder({ ...order, shortAlias: selectedCoordinator.shortAlias });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) {
          setPrivateOrderLoading(false);
          setOrderDetailsResolved(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, [activeSlot?.token, selectedCoordinator?.shortAlias, selectedCoordinator?.url, selectedOrder?.id, takeModalOpen]);

  useEffect(() => {
    if (!takeIntentPending || !orderDetailsResolved || privateOrderLoading) return;
    setTakeIntentPending(false);
    if (selectedDescription) setDescriptionConfirmOpen(true);
    else setConfirmTakeOpen(true);
  }, [orderDetailsResolved, privateOrderLoading, selectedDescription, takeIntentPending]);

  function openTakeModal(order: PublicOrder) {
    setSelectedOrderKey(orderKey(order));
    setTakeAmount(defaultTakeAmount(order));
    setOfferPassword("");
    setTakeError(undefined);
    setDescriptionConfirmOpen(false);
    setTakeIntentPending(false);
    const coordinator = coordinators.find((item) => item.shortAlias === order.coordinatorShortAlias);
    const canFetchDetails = Boolean(activeSlot && coordinator && getRobotAuthForCoordinator(activeSlot, coordinator.shortAlias));
    setOrderDetailsResolved(!canFetchDetails);
    setTakeModalOpen(true);
  }

  function closeTakeModal() {
    if (taking) return;
    setConfirmTakeOpen(false);
    setDescriptionConfirmOpen(false);
    setTakeIntentPending(false);
    setTakeModalOpen(false);
    setTakeError(undefined);
  }

  function beginTakeConfirmation() {
    if (selectedDescription) {
      setDescriptionConfirmOpen(true);
      return;
    }
    if (!orderDetailsResolved || privateOrderLoading) {
      setTakeIntentPending(true);
      return;
    }
    setConfirmTakeOpen(true);
  }

  function toggleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }

    setSortColumn(column);
    setSortDirection(column === "premium" ? "asc" : "desc");
  }

  async function takeSelectedOffer() {
    if (!selectedOrder) return;
    if (!selectedCoordinator) {
      setTakeError("Coordinator is not available right now.");
      return;
    }
    if (!activeSlot) {
      setTakeError("Create or recover a robot before taking an offer.");
      return;
    }

    const auth = getRobotAuthForCoordinator(activeSlot, selectedCoordinator.shortAlias);
    if (!auth) {
      setTakeError("This robot is missing coordinator credentials. Recover it from Garage first.");
      return;
    }

    const validationErrors = validateTakeOffer(selectedOrder, takeAmount);
    if (validationErrors.length > 0) {
      setTakeError(validationErrors[0]);
      return;
    }

    setTaking(true);
    setTakeError(undefined);
    try {
      const payload = buildTakeOfferPayload(selectedOrder, takeAmount, offerPassword);
      const order = await submitOrderAction(selectedCoordinator.url, selectedOrder.id, payload, auth);
      if (order.bad_request) {
        setPrivateOrder(order);
        setTakeError(toUserMessage(order.bad_request, "The coordinator could not take this offer."));
        return;
      }
      const orderId = order.id ?? selectedOrder.id;
      setActiveOrder(activeSlot.token, selectedCoordinator.shortAlias, orderId);
      navigate(`/order/${selectedCoordinator.shortAlias}/${orderId}`);
    } catch (error) {
      setTakeError(toUserMessage(error, "Could not take this offer."));
    } finally {
      setTaking(false);
    }
  }

  return (
    <main className="page page-wide">
      <section className="orderbook-layout">
        <Card className="orderbook-table-card">
          <CardHeader className="orderbook-card-header">
            <CardTitle>Public offers</CardTitle>
            <div className="orderbook-refresh-state">
              {refreshing ? <span className="orderbook-refreshing">Refreshing</span> : null}
              {!refreshing && error && orders.length > 0 ? <span className="orderbook-refreshing">Reconnecting</span> : null}
              {!refreshing && !error && lastUpdated ? <span className="muted-copy">Updated {new Date(lastUpdated).toLocaleTimeString()}</span> : null}
              <Button
                size="icon"
                variant="ghost"
                loading={loading || refreshing}
                disabled={loading || refreshing}
                onClick={() => void refresh(true)}
                aria-label="Refresh public offers"
                title="Refresh public offers"
              >
                {loading || refreshing ? null : <RefreshCw size={16} />}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="table-toolbar orderbook-toolbar">
              <div className="orderbook-filter-strip orderbook-secondary-filters" aria-label="Filter public offers">
                <div className="filter-select-field">
                  <span>I want to</span>
                  <IntentPicker
                    label="Filter public offers by trade direction"
                    options={intentOptions}
                    value={intentFilter}
                    onChange={(value) => {
                      setIntentFilter(value as IntentFilter);
                      setMethodFilter("all");
                    }}
                  />
                </div>
                <div className="filter-select-field">
                  <span>Currency</span>
                  <CurrencyPicker
                    label="Filter by currency"
                    options={[{ label: "ANY", value: "all" }, ...currencyOptions.map((currency) => ({ label: currency, value: currency }))]}
                    value={currencyFilter}
                    onChange={setCurrencyFilter}
                  />
                </div>
                <div className="filter-select-field filter-select-field-wide">
                  <span>{intentIsSwap(intentFilter) ? "Destination" : "Method"}</span>
                  <PaymentMethodPicker
                    label={intentIsSwap(intentFilter) ? "Filter by swap destination" : "Filter by payment method"}
                    options={methodOptions}
                    value={methodFilter}
                    onChange={setMethodFilter}
                  />
                </div>
              </div>
            </div>

            <div className="offer-mobile-sort" aria-label="Sort public offers">
              <span>Sort</span>
              <MobileSortButton active={sortColumn === "amount"} direction={sortDirection} onClick={() => toggleSort("amount")}>
                Amount
              </MobileSortButton>
              <MobileSortButton active={sortColumn === "premium"} direction={sortDirection} onClick={() => toggleSort("premium")}>
                Premium
              </MobileSortButton>
            </div>

            <div className="offer-table-scroll">
              <div className="offer-table">
                <div className="offer-table-header" role="row">
                  <span className="offer-table-header-cell">Type</span>
                  <SortHeader active={sortColumn === "amount"} direction={sortDirection} onClick={() => toggleSort("amount")}>
                    Amount
                  </SortHeader>
                  <SortHeader active={sortColumn === "premium"} direction={sortDirection} onClick={() => toggleSort("premium")}>
                    Premium
                  </SortHeader>
                  <SortHeader active={sortColumn === "bond"} direction={sortDirection} onClick={() => toggleSort("bond")}>
                    Bond
                  </SortHeader>
                  <SortHeader active={sortColumn === "expiry"} direction={sortDirection} onClick={() => toggleSort("expiry")}>
                    Expiry
                  </SortHeader>
                  <span className="offer-table-header-cell offer-table-header-center">Coordinator</span>
                </div>

                {error && orders.length === 0 ? (
                  <div className="status-panel status-panel-warning">
                    <WifiOff size={18} />
                    <span>{error}</span>
                  </div>
                ) : null}
                {!showInitialSkeleton && !loading && !refreshing && !error && filteredOrders.length === 0 ? (
                  <div className="status-panel">
                    <span>
                      {orders.length > 0
                        ? "No offers match the selected filters."
                        : "No public offers found from the enabled coordinators."}
                    </span>
                  </div>
                ) : null}

                {showInitialSkeleton ? <OfferSkeletonRows /> : null}

                {visibleOrders.map((order) => (
                  <button className="offer-row" key={orderKey(order)} onClick={() => openTakeModal(order)} type="button">
                    <span className={isTakerBuying(order) ? "offer-direction offer-direction-buy" : "offer-direction offer-direction-sell"}>
                      <DirectionIcon order={order} />
                    </span>
                    <span className="offer-main-cell">
                      <OfferAmountLine order={order} />
                      <OfferMethodLine order={order} />
                    </span>
                    <span className={premiumClassName(order.premium)}>{formatPremium(order.premium)}</span>
                    <BondDisplay order={order} />
                    <ExpiryDisplay expiresAt={order.expires_at} nowMs={nowMs} />
                    <CoordinatorPill coordinator={coordinators.find((item) => item.shortAlias === order.coordinatorShortAlias)} />
                  </button>
                ))}
              </div>
            </div>

            {filteredOrders.length > pageSize ? (
              <div className="orderbook-pagination">
                <Button
                  aria-label="Previous page"
                  disabled={currentPage <= 1}
                  size="icon"
                  variant="outline"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft size={18} />
                </Button>
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  aria-label="Next page"
                  disabled={currentPage >= totalPages}
                  size="icon"
                  variant="outline"
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                >
                  <ChevronRight size={18} />
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {takeModalOpen && selectedOrder ? (
        <TakeOfferModal
          coordinator={selectedCoordinator}
          error={takeError}
          hasActiveRobot={Boolean(activeSlot)}
          hasPassword={Boolean(selectedOrder.has_password || privateOrder?.has_password)}
          loadingDetails={privateOrderLoading}
          penalty={privateOrder?.penalty}
          description={selectedDescription}
          offerPassword={offerPassword}
          order={selectedOrder}
          setOfferPassword={setOfferPassword}
          setTakeAmount={setTakeAmount}
          takeAmount={takeAmount}
          taking={taking}
          preparingTake={takeIntentPending}
          onClose={closeTakeModal}
          onTake={beginTakeConfirmation}
        />
      ) : null}

      {descriptionConfirmOpen && selectedDescription ? (
        <OrderDescriptionDialog
          description={selectedDescription}
          onBack={() => setDescriptionConfirmOpen(false)}
          onContinue={() => {
            setDescriptionConfirmOpen(false);
            setConfirmTakeOpen(true);
          }}
        />
      ) : null}

      {confirmTakeOpen && activeSlot ? (
        <TokenBackupDialog
          robotName={activeSlot.nickname}
          token={activeSlot.token}
          taking={taking}
          onBack={() => setConfirmTakeOpen(false)}
          onDone={() => {
            setConfirmTakeOpen(false);
            void takeSelectedOffer();
          }}
        />
      ) : null}
    </main>
  );
}

function OfferSkeletonRows() {
  return (
    <>
      {Array.from({ length: 10 }, (_, index) => (
        <div className="offer-row offer-row-skeleton" key={index} aria-hidden>
          <Skeleton className="offer-skeleton-side" />
          <span className="offer-main-cell">
            <Skeleton className="offer-skeleton-amount" />
            <Skeleton className="offer-skeleton-method" />
          </span>
          <Skeleton className="offer-skeleton-short" />
          <Skeleton className="offer-skeleton-bond" />
          <Skeleton className="offer-skeleton-expiry" />
          <Skeleton className="offer-skeleton-host" />
        </div>
      ))}
    </>
  );
}

function SortHeader({
  active,
  children,
  direction,
  onClick
}: {
  active: boolean;
  children: string;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <button className={active ? "offer-table-header-cell offer-sort-button offer-sort-button-active" : "offer-table-header-cell offer-sort-button"} onClick={onClick} type="button">
      <span>{children}</span>
      <ArrowUpDown size={13} />
      {active ? <span className="sr-only">sorted {direction}</span> : null}
    </button>
  );
}

function MobileSortButton({
  active,
  children,
  direction,
  onClick
}: {
  active: boolean;
  children: string;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? "offer-mobile-sort-button offer-mobile-sort-button-active" : "offer-mobile-sort-button"}
      onClick={onClick}
      type="button"
    >
      <span>{children}</span>
      <ArrowUpDown size={13} />
      {active ? <span className="sr-only">sorted {direction}</span> : null}
    </button>
  );
}

function TakeOfferModal({
  coordinator,
  error,
  hasActiveRobot,
  hasPassword,
  loadingDetails,
  penalty,
  description,
  offerPassword,
  order,
  setOfferPassword,
  setTakeAmount,
  takeAmount,
  taking,
  preparingTake,
  onClose,
  onTake
}: {
  coordinator?: CoordinatorSummary;
  error?: string;
  hasActiveRobot: boolean;
  hasPassword: boolean;
  loadingDetails: boolean;
  penalty?: string;
  description?: string;
  offerPassword: string;
  order: PublicOrder;
  setOfferPassword: (value: string) => void;
  setTakeAmount: (value: string) => void;
  takeAmount: string;
  taking: boolean;
  preparingTake: boolean;
  onClose: () => void;
  onTake: () => void;
}) {
  const validationErrors = validateTakeOffer(order, takeAmount);
  const passwordMissing = hasPassword && !offerPassword.trim();
  const penaltyDeadline = penalty ? new Date(penalty).getTime() : 0;
  const penaltyActive = Number.isFinite(penaltyDeadline) && penaltyDeadline > Date.now();
  const amountOverride = selectedTakeAmount(order, takeAmount);
  const blockedReason = !hasActiveRobot
    ? "Create or recover a robot in Garage first."
    : !coordinator
      ? "Coordinator is not available right now."
      : penaltyActive
        ? `This robot can take another order after ${new Date(penaltyDeadline).toLocaleString()}.`
        : undefined;

  return (
    <div className="take-offer-overlay" onClick={onClose}>
      <section className="take-offer-sheet" onClick={(event) => event.stopPropagation()}>
        <button className="take-modal-close" onClick={onClose} type="button" aria-label="Close take offer">
          <X size={20} />
        </button>

        <header className="take-offer-header">
          <span className={isTakerBuying(order) ? "offer-direction offer-direction-buy" : "offer-direction offer-direction-sell"}>
            <DirectionIcon order={order} />
          </span>
          <div>
            <p className="app-eyebrow">{orderTypeLabel(order)}</p>
            <h2>
              <FiatAmount amountOverride={amountOverride} order={order} size={22} />
            </h2>
            <p>{formatOfferSats(order, coordinator, amountOverride)}</p>
          </div>
        </header>

        <TradeFlowPreview coordinator={coordinator} order={order} takeAmount={takeAmount} />

        <dl className="summary-list offer-summary">
          <SummaryItem
            help="Premium adjusts the offer relative to the coordinator market price. Negative values are discounts."
            label="Premium"
            value={formatPremium(order.premium)}
          />
          <SummaryItem
            help="The Lightning hold invoice each peer locks as a good-behavior bond."
            label="Bond"
            value={formatBond(order)}
          />
          <SummaryItem
            help="How long the offer remains available in the orderbook before it expires without a taker."
            label="Expiry"
            value={formatExpiryTitle(order.expires_at)}
          />
          <SummaryItem
            help={order.is_swap ? "Where the Lightning swap settles." : "The fiat payment methods accepted by the maker."}
            label={order.is_swap ? "Swap destination" : "Method"}
            value={order.payment_method || "Not specified"}
          />
          <SummaryItem
            help="The order host provides Lightning and communication infrastructure, sets trade fees, and handles disputes."
            label="Coordinator"
            value={coordinator?.longAlias ?? order.coordinatorShortAlias}
          />
        </dl>

        {description ? (
          <section className="take-offer-description" aria-label="Maker order description">
            <strong>Maker instructions</strong>
            <p>{description}</p>
          </section>
        ) : null}

        {order.has_range ? (
          <label className="field-block">
            Trade amount
            <input
              inputMode="decimal"
              min={order.min_amount}
              max={order.max_amount}
              type="number"
              value={takeAmount}
              onChange={(event) => setTakeAmount(event.target.value)}
            />
          </label>
        ) : null}

        {hasPassword ? (
          <label className="field-block">
            Private offer password
            <input
              autoComplete="off"
              placeholder="Enter the password shared by the maker"
              type="password"
              value={offerPassword}
              onChange={(event) => setOfferPassword(event.target.value)}
            />
          </label>
        ) : null}

        {blockedReason ? (
          <div className="status-panel">
            <AlertCircle size={16} />
            <span>{blockedReason}</span>
          </div>
        ) : null}
        {error ? (
          <div className="status-panel status-panel-warning">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}
        {!error && validationErrors.length > 0 ? (
          <div className="status-panel status-panel-warning">
            <AlertCircle size={16} />
            <span>{validationErrors[0]}</span>
          </div>
        ) : null}
        {!error && validationErrors.length === 0 && passwordMissing ? (
          <div className="status-panel status-panel-warning">
            <AlertCircle size={16} />
            <span>Enter the private offer password.</span>
          </div>
        ) : null}

        <div className="take-offer-actions">
          <Button variant="secondary" onClick={onClose} disabled={taking}>
            Cancel
          </Button>
          <Button
            disabled={Boolean(blockedReason) || validationErrors.length > 0 || passwordMissing || (hasPassword && loadingDetails)}
            loading={taking || preparingTake || (hasPassword && loadingDetails)}
            onClick={onTake}
          >
            <ArrowRight size={16} />
            Take offer
          </Button>
        </div>
      </section>
    </div>
  );
}

function OrderDescriptionDialog({
  description,
  onBack,
  onContinue
}: {
  description: string;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="order-description-title">
      <section className="confirm-sheet order-description-sheet">
        <div className="confirm-header">
          <span className="confirm-icon-shell"><AlertCircle size={20} /></span>
          <div>
            <h3 id="order-description-title">Order description</h3>
            <p className="muted-copy">The maker may have included instructions for the trade. Read and understand them before proceeding.</p>
          </div>
        </div>
        <blockquote className="order-description-copy">{description}</blockquote>
        <div className="confirm-actions">
          <Button variant="secondary" onClick={onBack}>Go back</Button>
          <Button onClick={onContinue}>I understand</Button>
        </div>
      </section>
    </div>
  );
}

function TokenBackupDialog({
  onBack,
  onDone,
  robotName,
  taking,
  token
}: {
  onBack: () => void;
  onDone: () => void;
  robotName: string;
  taking: boolean;
  token: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyToken() {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="confirm-overlay token-backup-overlay" role="dialog" aria-modal="true" aria-labelledby="token-backup-title">
      <section className="confirm-sheet token-backup-sheet">
        <div>
          <h3 id="token-backup-title">Store your robot token</h3>
          <p className="muted-copy">
            You may need it to recover this robot and the trade. Store it safely before locking a bond.
          </p>
        </div>
        <div className="token-backup-value">
          <div>
            <small>Back it up</small>
            <code>{token}</code>
          </div>
          <div className="token-backup-actions">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => downloadRobotTokenBackup(token, robotName)}
              aria-label={`Download ${robotName} token backup as JSON`}
              title="Download JSON backup"
            >
              <Download size={18} />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => void copyToken()} aria-label="Copy robot token">
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </Button>
          </div>
        </div>
        <div className="confirm-actions">
          <Button variant="secondary" disabled={taking} onClick={onBack}>Go back</Button>
          <Button loading={taking} onClick={onDone}>Done</Button>
        </div>
      </section>
    </div>
  );
}

function SummaryItem({ help, label, value }: { help?: string; label: string; value: string }) {
  return (
    <div>
      <dt>
        {label}
        {help ? <InfoHint title={help} /> : null}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function DirectionIcon({ order }: { order: PublicOrder }) {
  if (order.is_swap) return <Repeat2 size={18} />;
  return isTakerBuying(order) ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />;
}

function OfferAmountLine({ order }: { order: PublicOrder }) {
  const sats = knownSatsValue(order.satoshis) ?? knownSatsValue(order.satoshis_now);

  if (order.has_range || !sats) {
    return (
      <span className="offer-amount-line">
        <strong className={order.has_range ? "offer-amount-value offer-amount-value-range" : "offer-amount-value"}>
          <FiatAmount order={order} size={18} />
        </strong>
      </span>
    );
  }

  return (
    <span className="offer-amount-line">
      <strong className="amount-mono">{formatSats(sats)}</strong>
      <span>
        <FiatAmount order={order} size={17} />
      </span>
    </span>
  );
}

function OfferMethodLine({ order }: { order: PublicOrder }) {
  const hasMethodIcon = matchedPaymentMethods(order.payment_method).length > 0;

  return (
    <span className={hasMethodIcon ? "offer-method-line offer-method-line-has-icon" : "offer-method-line"}>
      <PaymentMethodIcons text={order.payment_method} size={22} />
      <span className="offer-method-text">{order.payment_method || "Not specified"}</span>
      {order.is_swap ? <span className="offer-swap-chip">Swap</span> : null}
    </span>
  );
}

function TradeFlowPreview({
  coordinator,
  order,
  takeAmount
}: {
  coordinator?: CoordinatorSummary;
  order: PublicOrder;
  takeAmount: string;
}) {
  const buying = isTakerBuying(order);
  const sendDetail = order.is_swap ? (buying ? order.payment_method || "On-chain bitcoin" : "Lightning escrow") : buying ? order.payment_method || "Fiat payment" : "Lightning escrow";
  const receiveDetail = order.is_swap ? (buying ? "Bitcoin on-chain" : order.payment_method || "On-chain bitcoin") : buying ? "Bitcoin over Lightning" : order.payment_method || "Fiat payment";
  const amountOverride = selectedTakeAmount(order, takeAmount);
  const fiat = <FiatAmount amountOverride={amountOverride} order={order} size={18} />;
  const sats = <BtcAmountPreview amountOverride={amountOverride} coordinator={coordinator} order={order} />;

  return (
    <div className="take-flow-summary" aria-label="Trade preview">
      <TradeFlowCard
        label="You send"
        tone="send"
        value={buying ? fiat : sats}
        detail={sendDetail}
      />
      <span className="take-flow-arrow" aria-hidden>
        <ArrowRight size={18} />
      </span>
      <TradeFlowCard
        label="You receive"
        tone="receive"
        value={buying ? sats : fiat}
        detail={receiveDetail}
      />
    </div>
  );
}

function BtcAmountPreview({
  amountOverride,
  coordinator,
  order
}: {
  amountOverride?: number;
  coordinator?: CoordinatorSummary;
  order: PublicOrder;
}) {
  const value = formatOfferSats(order, coordinator, amountOverride);
  const pending = value === "Set amount first" || value === "Quote after take";

  return <span className={pending ? "take-flow-pending" : undefined}>{value}</span>;
}

function TradeFlowCard({
  detail,
  label,
  tone,
  value
}: {
  detail: string;
  label: string;
  tone: "receive" | "send";
  value: ReactNode;
}) {
  return (
    <div className={`take-flow-card take-flow-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function FiatAmount({ amountOverride, order, size = 18 }: { amountOverride?: number; order: PublicOrder; size?: number }) {
  return (
    <span className="offer-fiat-with-flag">
      <span>{formatOfferFiat(order, amountOverride)}</span>
      <CurrencyFlag code={order.currencyCode ?? String(order.currency)} size={size} />
    </span>
  );
}

function BondDisplay({ order }: { order: PublicOrder }) {
  const bond = bondDisplayValue(order);
  const percentLabel = bond.percent != null ? `${formatCompactNumber(bond.percent)}%` : undefined;

  return (
    <span className="offer-bond-cell">
      <Lock size={14} />
      <span>
        <strong className="amount-mono">{bond.sats > 0 ? formatSats(bond.sats) : percentLabel ?? "-"}</strong>
        {bond.sats > 0 && percentLabel ? <small>{percentLabel}</small> : null}
      </span>
    </span>
  );
}

function ExpiryDisplay({ expiresAt, nowMs }: { expiresAt?: string; nowMs: number }) {
  const expiry = expiryRingValue(expiresAt, nowMs);
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, expiry.percent)) / 100) * circumference;

  return (
    <span className={`offer-expiry offer-expiry-${expiry.tone}`} title={formatExpiryTitle(expiresAt)}>
      <span className="offer-expiry-ring">
        <svg className="offer-expiry-svg" aria-hidden viewBox="0 0 40 40">
          <circle className="offer-expiry-track" cx="20" cy="20" r={radius} />
          <circle
            className="offer-expiry-progress"
            cx="20"
            cy="20"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <span className="offer-expiry-text">{expiry.text}</span>
      </span>
    </span>
  );
}

function CoordinatorPill({ coordinator }: { coordinator?: CoordinatorSummary }) {
  if (!coordinator) return <span className="coordinator-pill coordinator-pill-muted">?</span>;

  return (
    <span className="coordinator-pill" title={coordinator.longAlias}>
      <img className="coordinator-avatar coordinator-avatar-xs" src={coordinator.smallAvatarUrl} alt="" />
    </span>
  );
}

function compareOrders(left: PublicOrder, right: PublicOrder, column: SortColumn, direction: SortDirection): number {
  const multiplier = direction === "asc" ? 1 : -1;
  const leftValue = sortValue(left, column);
  const rightValue = sortValue(right, column);

  if (leftValue === rightValue) return orderKey(left).localeCompare(orderKey(right));
  return (leftValue - rightValue) * multiplier;
}

function sortValue(order: PublicOrder, column: SortColumn): number {
  if (column === "amount") return knownSatsValue(order.satoshis) ?? knownSatsValue(order.satoshis_now) ?? safeNumber(order.amount);
  if (column === "premium") return safeNumber(order.premium);
  if (column === "bond") return bondDisplayValue(order).sortValue;
  const expiryMs = order.expires_at ? Date.parse(order.expires_at) : Number.POSITIVE_INFINITY;
  return Number.isFinite(expiryMs) ? expiryMs : Number.POSITIVE_INFINITY;
}

function orderTypeLabel(order: PublicOrder): string {
  return roleIntentLabel(order.type, order.is_swap, "taker");
}

function orderMatchesIntent(order: PublicOrder, intent: IntentFilter): boolean {
  if (intent === "any") return !order.is_swap;
  if (intent === "buy") return !order.is_swap && isTakerBuying(order);
  if (intent === "sell") return !order.is_swap && !isTakerBuying(order);
  if (intent === "swap-in") return order.is_swap && isTakerBuying(order);
  return order.is_swap && !isTakerBuying(order);
}

function intentIsSwap(intent: IntentFilter): boolean {
  return intent === "swap-in" || intent === "swap-out";
}

function isTakerBuying(order: PublicOrder): boolean {
  return roleBuysBitcoin(order.type, "taker");
}

function orderMatchesMethod(paymentMethod: string, selectedMethod: string): boolean {
  if (paymentMethod === selectedMethod) return true;
  if (matchedPaymentMethods(paymentMethod).some((method) => method.name === selectedMethod)) return true;
  return paymentMethod.toLowerCase().includes(selectedMethod.toLowerCase());
}

function orderKey(order?: PublicOrder): string {
  return order ? `${order.coordinatorShortAlias}-${order.id}` : "";
}

function formatOfferFiat(order: PublicOrder, amountOverride?: number): string {
  const currency = order.currencyCode ?? String(order.currency);
  if (amountOverride != null) return formatFiat(amountOverride, currency);
  if (order.has_range) {
    return `${formatFiat(order.min_amount)} - ${formatFiat(order.max_amount, currency)}`;
  }
  return formatFiat(order.amount, currency);
}

function formatOfferSats(order: PublicOrder, coordinator?: CoordinatorSummary, amountOverride?: number): string {
  if (order.has_range && amountOverride == null) return "Set amount first";

  const preview = orderSatsPreview(order, coordinator?.limits, amountOverride);
  if (!preview) return "Quote after take";

  return `${preview.approx ? "Approx. " : ""}${formatSats(preview.sats)}`;
}

function formatBond(order: PublicOrder): string {
  const bond = bondDisplayValue(order);
  const percentLabel = bond.percent != null ? `${formatCompactNumber(bond.percent)}%` : undefined;
  if (bond.sats > 0 && percentLabel) return `${formatSats(bond.sats)} (${percentLabel})`;
  if (bond.sats > 0) return formatSats(bond.sats);
  return percentLabel ?? "-";
}

function formatPremium(value: number | string | null | undefined): string {
  const premium = safeNumber(value);
  const sign = premium > 0 ? "+" : "";
  return `${sign}${premium.toFixed(2)}%`;
}

function premiumClassName(value: number | string | null | undefined): string {
  const premium = safeNumber(value);
  if (premium > 0) return "tabular offer-premium offer-premium-positive";
  if (premium < 0) return "tabular offer-premium offer-premium-negative";
  return "tabular offer-premium";
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function selectedTakeAmount(order: PublicOrder, takeAmount: string): number | undefined {
  if (!order.has_range) return undefined;
  const amount = safeNumber(takeAmount);
  return amount > 0 ? amount : undefined;
}

function safeNumber(value: number | string | null | undefined): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function currentHostUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location.host || window.location.hostname;
}
