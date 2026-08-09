import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Download,
  Lock,
  MapPin,
  MapPinned,
  RefreshCw,
  Repeat2,
  Search,
  WifiOff,
  X
} from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { beginRouteTransition } from "@/domains/navigation/routeTransition";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { useOrderbookStore } from "@/domains/orderbook/orderbookStore";
import { currencyIdFromCode, orderCurrencyCodes } from "@/domains/orderbook/currencies";
import { resetNostrOrderbookSession, subscribeNostrOrderbook } from "@/domains/orderbook/nostrOrderbook";
import { subscribeRefreshIntents, type RefreshReason } from "@/domains/transport/refreshIntents";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { activePublicOrders, filterPublicOrders } from "@/domains/orderbook/orderbookFilters";
import { buildTakeOfferPayload, defaultTakeAmount, validateTakeOffer } from "@/domains/orderbook/takeOffer";
import {
  getRobotAuthForCoordinator,
  selectCurrentSlot,
  selectStandardGarageSlots,
  useGarageStore,
  type RobotSlot
} from "@/domains/garage/garageStore";
import { getRobotOrderAvailability } from "@/domains/garage/robotAvailability";
import { reserveRobotOrderAction, revalidateRobotForNewOrder } from "@/domains/orders/robotOrderGuard";
import { downloadRobotTokenBackup } from "@/domains/garage/tokenBackup";
import { ingestCoordinatorOrder } from "@/domains/orders/orderActivity";
import { openConfirmedOrder } from "@/domains/orders/confirmedOrderNavigation";
import { preloadOrderRoute } from "@/domains/orders/orderRoute";
import { writeClipboard } from "@/lib/clipboard";
import { fetchOrder, isCompleteOrderActionResponse, submitOrderAction } from "@/domains/orders/orderApi";
import { roleBuysBitcoin, roleIntentLabel } from "@/domains/orders/orderRole";
import type { OrderDto } from "@/domains/orders/order.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { AppTransitionDialog } from "@/domains/navigation/AppTransitionFeedback";
import { preloadStatisticsRoute } from "@/domains/statistics/statisticsRoute";
import { InfoHint } from "@/components/ui/infoHint";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CurrencyFlag,
  CurrencyPicker,
  FilterAnyMonochromeIcon,
  IntentPicker,
  PaymentMethodIcons,
  PaymentMethodPicker,
  type IntentPickerOption
} from "@/domains/orderbook/OfferMeta";
import type { GuidedTradeCriteria } from "@/domains/orderbook/guidedTrade";
import {
  isSwapPaymentMethod,
  matchedPaymentMethods,
  paymentIconSrc,
  paymentMethodOptions
} from "@/domains/orderbook/paymentMethods";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import {
  bondDisplayValue,
  expiryRingValue,
  formatExpiryTitle,
  knownSatsValue,
  orderSatsPreview
} from "@/domains/orderbook/offerDisplay";
import { formatFiat, formatSats } from "@/lib/format";
import { toUserMessage } from "@/lib/userError";
import { hasApproximateF2FLocation, paymentMethodHasF2F, selectCashF2FOffers } from "@/domains/location/f2fLocation";

type SortColumn = "amount" | "premium" | "expiry";
type SortDirection = "asc" | "desc";
type IntentFilter = "any" | "buy" | "sell" | "swap-in" | "swap-out";
type OpenFilter = "intent" | "currency" | "method";
type GuidedTradeLaunch = {
  criteria: GuidedTradeCriteria;
  returnTo?: string;
  reviewOrder: PublicOrder;
};
type DirectOfferLaunch = {
  reviewOrder: PublicOrder;
};
type OffersLocationState = {
  directOfferLaunch?: DirectOfferLaunch;
  guidedTradeLaunch?: GuidedTradeLaunch;
};

const pageSize = 13;
const intentOptions: IntentPickerOption[] = [
  { label: "ANY", value: "any", tone: "any" },
  { label: "BUY", value: "buy", tone: "buy" },
  { label: "SELL", value: "sell", tone: "sell" },
  { label: "SWAP IN", value: "swap-in", tone: "swap-in" },
  { label: "SWAP OUT", value: "swap-out", tone: "swap-out" }
];
const preloadedPaymentIconUrls = new Set<string>();
const loadF2FOffersMapDialog = () =>
  import("@/domains/location/F2FOffersMapDialog").then((module) => ({ default: module.F2FOffersMapDialog }));
const LazyF2FOffersMapDialog = lazy(loadF2FOffersMapDialog);
const LazyF2FLocationDialog = lazy(() =>
  import("@/domains/location/F2FLocationDialog").then((module) => ({ default: module.F2FLocationDialog }))
);
const LazyBeginnerTradeWizard = lazy(() =>
  import("@/domains/orderbook/BeginnerTradeWizard").then((module) => ({ default: module.BeginnerTradeWizard }))
);
const LazyProTakeRobotPicker = lazy(() =>
  import("@/domains/pro/ProTakeRobotPicker").then((module) => ({ default: module.ProTakeRobotPicker }))
);

export function OffersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [guidedLaunch] = useState(() => (location.state as OffersLocationState | null)?.guidedTradeLaunch);
  const [directOfferLaunch] = useState(() => (location.state as OffersLocationState | null)?.directOfferLaunch);
  const connection = useFederationStore((state) => state.connection);
  const coordinators = useFederationStore((state) => state.coordinators);
  const origin = useFederationStore((state) => state.origin);
  const refreshCoordinators = useFederationStore((state) => state.refreshCoordinators);
  const refreshCoordinatorLimits = useFederationStore((state) => state.refreshCoordinatorLimits);
  const orders = useOrderbookStore((state) => state.orders);
  const loading = useOrderbookStore((state) => state.loading);
  const refreshing = useOrderbookStore((state) => state.refreshing);
  const cacheState = useOrderbookStore((state) => state.cacheState);
  const error = useOrderbookStore((state) => state.error);
  const lastUpdated = useOrderbookStore((state) => state.lastUpdated);
  const refreshOrderbook = useOrderbookStore((state) => state.refreshOrderbook);
  const applyLiveOrders = useOrderbookStore((state) => state.applyLiveOrders);
  const hydrateGarage = useGarageStore((state) => state.hydrate);
  const garageSlots = useGarageStore((state) => state.slots);
  const currentToken = useGarageStore((state) => state.currentToken);
  const setCurrentToken = useGarageStore((state) => state.setCurrentToken);
  const proEnabled = useProPreferencesStore((state) => state.enabled);
  const setProLastView = useProPreferencesStore((state) => state.setLastView);
  const [intentFilter, setIntentFilter] = useState<IntentFilter>("any");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [openFilter, setOpenFilter] = useState<OpenFilter | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [selectedOrderKey, setSelectedOrderKey] = useState<string | null>(null);
  const [takeModalOpen, setTakeModalOpen] = useState(false);
  const [takeAmount, setTakeAmount] = useState("");
  const takeAmountPrefill = useRef<number | undefined>(undefined);
  const [offerPassword, setOfferPassword] = useState("");
  const [takeError, setTakeError] = useState<string | undefined>();
  const [taking, setTaking] = useState(false);
  const [confirmTakeOpen, setConfirmTakeOpen] = useState(false);
  const [descriptionConfirmOpen, setDescriptionConfirmOpen] = useState(false);
  const [takeIntentPending, setTakeIntentPending] = useState(false);
  const [takeRobotPickerOpen, setTakeRobotPickerOpen] = useState(false);
  const [proTakeSlotId, setProTakeSlotId] = useState<string>();
  const [privateOrder, setPrivateOrder] = useState<OrderDto | undefined>();
  const [privateOrderLoading, setPrivateOrderLoading] = useState(false);
  const [orderDetailsResolved, setOrderDetailsResolved] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [nostrSessionEpoch, setNostrSessionEpoch] = useState(0);
  const [guidedTradeOpen, setGuidedTradeOpen] = useState(
    () => searchParams.get("guided") === "1" || Boolean(guidedLaunch)
  );
  const [guidedReviewOpened, setGuidedReviewOpened] = useState(false);
  const [directReviewOpened, setDirectReviewOpened] = useState(false);
  const [f2fOffersMapOpen, setF2FOffersMapOpen] = useState(false);
  const standardSlots = useMemo(() => selectStandardGarageSlots(garageSlots), [garageSlots]);
  const activeOrders = useMemo(() => activePublicOrders(orders, nowMs), [nowMs, orders]);
  const cashF2FOffers = useMemo(() => selectCashF2FOffers(activeOrders), [activeOrders]);
  const activeSlot = selectCurrentSlot(standardSlots, currentToken);
  const standardTakeAvailability = getRobotOrderAvailability(activeSlot);
  const takeRobotUnavailableMessage = proEnabled
    ? undefined
    : standardTakeAvailability.available
      ? undefined
      : (standardTakeAvailability.message ?? "Create or recover a robot in Garage first.");

  useEffect(() => {
    if (searchParams.get("guided") !== "1") return;

    setGuidedTradeOpen(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("guided");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);
  const takeSlot = proEnabled ? garageSlots.find((slot) => slot.tokenSHA256 === proTakeSlotId) : activeSlot;

  async function refresh(force = false) {
    const currentState = useFederationStore.getState();

    if (currentState.connection === "nostr") {
      if (force) {
        resetNostrOrderbookSession();
        setNostrSessionEpoch((value) => value + 1);
      }
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
    // every coordinator before /book can start. Federation health has its own
    // slower TTL and updates independently from the visible orderbook.
    void refreshCoordinators().catch(() => undefined);
    await refreshOrderbook(currentState.coordinators, {
      connection: currentState.connection,
      force,
      network: currentState.network,
      origin: currentState.origin
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
        applyLiveOrders(liveOrders, "nostr", state.network, state.origin, meta.partial || !meta.authoritative);
      }
    });
  }, [applyLiveOrders, connection, coordinatorSubscriptionKey, nostrSessionEpoch, origin]);

  useEffect(() => {
    let refreshTimer: number | undefined;

    const refreshAfterLifecycle = (reason: RefreshReason) => {
      const restartNostr =
        connection === "nostr" && (reason === "online" || reason === "tor-reconnected" || Boolean(error));
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(restartNostr || Boolean(error)), 150);
    };

    const stopLifecycle = subscribeRefreshIntents(refreshAfterLifecycle);

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      stopLifecycle();
    };
  }, [connection, error]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const currencyOptions = useMemo(() => {
    return orderCurrencyCodes(activeOrders.map((order) => order.currencyCode ?? String(order.currency)));
  }, [activeOrders]);
  const methodOptions = useMemo(() => {
    const present = new Set<string>();

    for (const order of activeOrders) {
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
  }, [activeOrders, intentFilter]);

  const filteredOrders = useMemo(() => {
    const baseOrders = filterPublicOrders(activeOrders, { side: "all", coordinator: "all" }).filter((order) => {
      const currency = order.currencyCode ?? String(order.currency);
      if (!orderMatchesIntent(order, intentFilter)) return false;
      if (currencyFilter !== "all" && currency !== currencyFilter) return false;
      if (methodFilter !== "all" && !orderMatchesMethod(order.payment_method, methodFilter)) return false;
      return true;
    });

    if (!sortColumn) return baseOrders;
    return [...baseOrders].sort((left, right) => compareOrders(left, right, sortColumn, sortDirection));
  }, [activeOrders, currencyFilter, intentFilter, methodFilter, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleOrders = useMemo(
    () => filteredOrders.slice(pageStart, pageStart + pageSize),
    [filteredOrders, pageStart]
  );
  const visiblePaymentMethodKey = useMemo(
    () => visibleOrders.map((order) => order.payment_method).join("|"),
    [visibleOrders]
  );
  const selectedOrder = selectedOrderKey
    ? (filteredOrders.find((order) => orderKey(order) === selectedOrderKey) ??
      (orderKey(directOfferLaunch?.reviewOrder) === selectedOrderKey ? directOfferLaunch?.reviewOrder : undefined))
    : undefined;
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

    setTakeAmount(defaultTakeAmount(selectedOrder, takeAmountPrefill.current));
    setOfferPassword("");
    setTakeError(undefined);
  }, [selectedOrder?.coordinatorShortAlias, selectedOrder?.id]);

  useEffect(() => {
    setPrivateOrder(undefined);
    setPrivateOrderLoading(false);
    setOrderDetailsResolved(true);
    if (!takeModalOpen || !selectedOrder || !selectedCoordinator || !takeSlot) return;
    const auth = getRobotAuthForCoordinator(takeSlot, selectedCoordinator.shortAlias);
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
  }, [selectedCoordinator?.shortAlias, selectedCoordinator?.url, selectedOrder?.id, takeModalOpen, takeSlot?.token]);

  useEffect(() => {
    if (!takeModalOpen || !selectedCoordinator || selectedCoordinator.limits) return;
    void refreshCoordinatorLimits(selectedCoordinator.shortAlias, { priority: "visible" });
  }, [refreshCoordinatorLimits, selectedCoordinator, takeModalOpen]);

  useEffect(() => {
    if (!takeIntentPending || !orderDetailsResolved || privateOrderLoading) return;
    setTakeIntentPending(false);
    if (selectedDescription) setDescriptionConfirmOpen(true);
    else setConfirmTakeOpen(true);
  }, [orderDetailsResolved, privateOrderLoading, selectedDescription, takeIntentPending]);

  function openTakeModal(order: PublicOrder, preferredAmount?: number) {
    takeAmountPrefill.current = preferredAmount;
    setSelectedOrderKey(orderKey(order));
    setTakeAmount(defaultTakeAmount(order, preferredAmount));
    setOfferPassword("");
    setTakeError(undefined);
    setDescriptionConfirmOpen(false);
    setTakeIntentPending(false);
    setTakeRobotPickerOpen(false);
    setProTakeSlotId(undefined);
    const coordinator = coordinators.find((item) => item.shortAlias === order.coordinatorShortAlias);
    const initialSlot = proEnabled ? undefined : activeSlot;
    const canFetchDetails = Boolean(
      initialSlot && coordinator && getRobotAuthForCoordinator(initialSlot, coordinator.shortAlias)
    );
    setOrderDetailsResolved(!canFetchDetails);
    setTakeModalOpen(true);
  }

  useEffect(() => {
    if (!guidedLaunch || guidedReviewOpened) return;

    setGuidedReviewOpened(true);
    openTakeModal(guidedLaunch.reviewOrder, guidedLaunch.criteria.amount);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [guidedLaunch, guidedReviewOpened, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!directOfferLaunch || directReviewOpened) return;

    setDirectReviewOpened(true);
    openTakeModal(directOfferLaunch.reviewOrder);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [directOfferLaunch, directReviewOpened, location.pathname, location.search, navigate]);

  function closeTakeModal() {
    if (taking) return;
    setConfirmTakeOpen(false);
    setDescriptionConfirmOpen(false);
    setTakeIntentPending(false);
    setTakeRobotPickerOpen(false);
    setProTakeSlotId(undefined);
    setTakeModalOpen(false);
    setTakeError(undefined);
  }

  function beginTakeConfirmation() {
    if (proEnabled && !takeSlot) {
      setTakeRobotPickerOpen(true);
      return;
    }
    continueTakeConfirmation();
  }

  function selectTakeRobot(slot: RobotSlot) {
    setProTakeSlotId(slot.tokenSHA256);
    setTakeRobotPickerOpen(false);
    setOrderDetailsResolved(false);
    setTakeIntentPending(true);
    setTakeError(undefined);
  }

  function continueTakeConfirmation() {
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
    if (!takeSlot) {
      setTakeError("Create or recover a robot before taking an offer.");
      return;
    }

    const auth = getRobotAuthForCoordinator(takeSlot, selectedCoordinator.shortAlias);
    if (!auth) {
      setTakeError("This robot is missing coordinator credentials. Recover it from Garage first.");
      return;
    }

    const validationErrors = validateTakeOffer(selectedOrder, takeAmount);
    if (validationErrors.length > 0) {
      setTakeError(validationErrors[0]);
      return;
    }

    const releaseReservation = reserveRobotOrderAction(takeSlot.tokenSHA256);
    if (!releaseReservation) {
      setTakeError(`${takeSlot.nickname} is already starting another order.`);
      return;
    }

    setTaking(true);
    setTakeError(undefined);
    preloadOrderRoute();
    try {
      const actionSlot = await revalidateRobotForNewOrder({
        coordinator: selectedCoordinator,
        proEnabled,
        slotId: takeSlot.tokenSHA256
      });
      const actionAuth = getRobotAuthForCoordinator(actionSlot, selectedCoordinator.shortAlias);
      if (!actionAuth) throw new Error("This robot is missing coordinator credentials.");
      const payload = buildTakeOfferPayload(selectedOrder, takeAmount, offerPassword);
      const order = await submitOrderAction(selectedCoordinator.url, selectedOrder.id, payload, actionAuth);
      if (order.bad_request) {
        setPrivateOrder(order);
        setTakeError(toUserMessage(order.bad_request, "The coordinator could not take this offer."));
        return;
      }
      const orderId = order.id || selectedOrder.id;
      const confirmedOrder = {
        ...order,
        id: orderId,
        shortAlias: selectedCoordinator.shortAlias
      };
      if (proEnabled) setProLastView("trades");
      openConfirmedOrder(navigate, {
        coordinatorEndpoint: selectedCoordinator.url,
        initialOrder: isCompleteOrderActionResponse(order) ? confirmedOrder : undefined,
        orderId,
        shortAlias: selectedCoordinator.shortAlias,
        slotId: actionSlot.tokenSHA256
      });

      // Local indexing is repairable from the authoritative Trade-page read and
      // must not strand a coordinator-confirmed take on the orderbook.
      try {
        setCurrentToken(actionSlot.token);
        ingestCoordinatorOrder({
          order: confirmedOrder,
          shortAlias: selectedCoordinator.shortAlias,
          slot: actionSlot
        });
      } catch {
        // The Trade page performs the authoritative repair.
      }
    } catch (error) {
      setTakeError(toUserMessage(error, "Could not take this offer."));
      if (proEnabled) setProTakeSlotId(undefined);
    } finally {
      releaseReservation();
      setTaking(false);
    }
  }

  function createGuidedOffer(criteria: GuidedTradeCriteria) {
    const prefillDraft = {
      type: criteria.intent === "buy" ? 0 : 1,
      currency: currencyIdFromCode(criteria.currency),
      amount: String(criteria.amount),
      paymentMethod: criteria.paymentMethod
    };

    setGuidedTradeOpen(false);
    navigate(proEnabled ? "/pro" : "/create", {
      state: proEnabled ? { openCreate: true, prefillDraft } : { prefillDraft }
    });
  }

  function closeGuidedTrade() {
    setGuidedTradeOpen(false);
    if (guidedLaunch?.returnTo) navigate(guidedLaunch.returnTo, { replace: true });
  }

  return (
    <main className="page page-wide">
      <section className="orderbook-layout">
        <Card className="orderbook-table-card">
          <CardHeader className="orderbook-card-header">
            <div className="orderbook-heading-group">
              <OffersHeadingCopy
                activeOfferCount={activeOrders.length}
                cached={cacheState !== "none"}
                hasError={Boolean(error)}
                lastUpdated={lastUpdated}
                live={connection === "nostr"}
                nowMs={nowMs}
              />
              <div className="orderbook-heading-actions">
                <Button
                  aria-label="Find a trade step by step"
                  className="orderbook-guided-trade-link orderbook-guided-trade-link-primary"
                  onClick={() => setGuidedTradeOpen(true)}
                  size="sm"
                  title="Find a trade step by step"
                  type="button"
                  variant="ghost"
                >
                  <Search size={15} />
                  <span>Guided trade</span>
                </Button>
                <Button
                  aria-label="View market statistics"
                  className="orderbook-guided-trade-link orderbook-statistics-link"
                  onClick={() => {
                    beginRouteTransition("/statistics");
                    navigate("/statistics");
                  }}
                  onFocus={preloadStatisticsRoute}
                  onPointerEnter={preloadStatisticsRoute}
                  size="sm"
                  title="View market statistics"
                  type="button"
                  variant="ghost"
                >
                  <BarChart3 size={15} />
                  <span className="orderbook-statistics-label">Statistics</span>
                </Button>
                {cashF2FOffers.length > 0 ? (
                  <Button
                    aria-label={`View ${cashF2FOffers.length} Cash F2F ${cashF2FOffers.length === 1 ? "offer" : "offers"} on a map`}
                    className="orderbook-guided-trade-link orderbook-f2f-map-link"
                    onClick={() => setF2FOffersMapOpen(true)}
                    onFocus={() => void loadF2FOffersMapDialog()}
                    onPointerEnter={() => void loadF2FOffersMapDialog()}
                    size="sm"
                    title="View Cash F2F offers on a map"
                    type="button"
                    variant="ghost"
                  >
                    <MapPinned size={15} />
                    <span>F2F map</span>
                    <small>{cashF2FOffers.length}</small>
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="orderbook-refresh-state">
              {refreshing ? <span className="orderbook-refreshing">Updating</span> : null}
              {!refreshing && error && orders.length > 0 ? (
                <span className="orderbook-refreshing">Reconnecting</span>
              ) : null}
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
              <div className="orderbook-mobile-filter-heading">
                <span>Filter offers</span>
                <small>{filteredOrders.length} shown</small>
              </div>
              <div className="orderbook-filter-strip orderbook-secondary-filters" aria-label="Filter public offers">
                <div className="filter-select-field">
                  <span>Buy/Sell</span>
                  <IntentPicker
                    label="Filter public offers by trade direction"
                    open={openFilter === "intent"}
                    options={intentOptions}
                    value={intentFilter}
                    onChange={(value) => {
                      setIntentFilter(value as IntentFilter);
                      setMethodFilter("all");
                    }}
                    onOpenChange={(open) =>
                      setOpenFilter((current) => (open ? "intent" : current === "intent" ? null : current))
                    }
                  />
                </div>
                <div className="filter-select-field">
                  <span>Currency</span>
                  <CurrencyPicker
                    label="Filter by currency"
                    open={openFilter === "currency"}
                    options={[
                      { label: "ANY", value: "all" },
                      ...currencyOptions.map((currency) => ({ label: currency, value: currency }))
                    ]}
                    value={currencyFilter}
                    onChange={(value) => {
                      if (value === currencyFilter) return;
                      setCurrencyFilter(value);
                      setMethodFilter("all");
                    }}
                    onOpenChange={(open) =>
                      setOpenFilter((current) => (open ? "currency" : current === "currency" ? null : current))
                    }
                  />
                </div>
                <div className="filter-select-field filter-select-field-wide">
                  <span>{intentIsSwap(intentFilter) ? "Destination" : "Payment Method"}</span>
                  <PaymentMethodPicker
                    defaultIcon={<FilterAnyMonochromeIcon kind="payment-method" />}
                    label={intentIsSwap(intentFilter) ? "Filter by swap destination" : "Filter by payment method"}
                    open={openFilter === "method"}
                    options={methodOptions}
                    value={methodFilter}
                    onChange={setMethodFilter}
                    onOpenChange={(open) =>
                      setOpenFilter((current) => (open ? "method" : current === "method" ? null : current))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="offer-mobile-sort" aria-label="Sort public offers">
              <span className="offer-mobile-sort-heading">
                <ArrowUpDown size={14} /> Sort offers
              </span>
              <div className="offer-mobile-sort-options">
                <MobileSortButton
                  active={sortColumn === "amount"}
                  direction={sortDirection}
                  onClick={() => toggleSort("amount")}
                >
                  Amount
                </MobileSortButton>
                <MobileSortButton
                  active={sortColumn === "premium"}
                  direction={sortDirection}
                  onClick={() => toggleSort("premium")}
                >
                  Premium
                </MobileSortButton>
                <MobileSortButton
                  active={sortColumn === "expiry"}
                  direction={sortDirection}
                  onClick={() => toggleSort("expiry")}
                >
                  Expiry
                </MobileSortButton>
              </div>
            </div>

            <div className="offer-table-scroll">
              <div className="offer-table">
                <div className="offer-table-header" role="row">
                  <span className="offer-table-header-cell">Type</span>
                  <SortHeader
                    active={sortColumn === "amount"}
                    direction={sortDirection}
                    onClick={() => toggleSort("amount")}
                  >
                    Amount
                  </SortHeader>
                  <SortHeader
                    active={sortColumn === "premium"}
                    direction={sortDirection}
                    onClick={() => toggleSort("premium")}
                  >
                    Premium
                  </SortHeader>
                  <span className="offer-table-header-cell">Payment Method</span>
                  <SortHeader
                    active={sortColumn === "expiry"}
                    direction={sortDirection}
                    onClick={() => toggleSort("expiry")}
                  >
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

                {visibleOrders.map((order, index) => (
                  <button
                    className={isTakerBuying(order) ? "offer-row offer-row-buy" : "offer-row offer-row-sell"}
                    key={orderKey(order)}
                    onClick={() => openTakeModal(order)}
                    style={{ "--offer-row-index": index } as CSSProperties}
                    type="button"
                  >
                    <span
                      className={
                        isTakerBuying(order)
                          ? "offer-direction offer-direction-buy"
                          : "offer-direction offer-direction-sell"
                      }
                    >
                      <DirectionIcon order={order} />
                      <small>{order.is_swap ? "SWAP" : isTakerBuying(order) ? "BUY" : "SELL"}</small>
                    </span>
                    <span className="offer-main-cell">
                      <OfferAmountLine order={order} />
                    </span>
                    <span className={premiumClassName(order.premium)}>{formatPremium(order.premium)}</span>
                    <span className="offer-method-cell">
                      <OfferMethodLine order={order} />
                    </span>
                    <ExpiryDisplay expiresAt={order.expires_at} nowMs={nowMs} />
                    <span className="offer-row-review">
                      <CoordinatorPill
                        coordinator={coordinators.find((item) => item.shortAlias === order.coordinatorShortAlias)}
                        showName
                      />
                      <span className="offer-review-affordance">
                        <span>Review</span>
                        <ArrowRight size={15} />
                      </span>
                    </span>
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

      {guidedTradeOpen ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              closeLabel="Close trade finder"
              message="Loading the guided trade steps..."
              onClose={closeGuidedTrade}
              title="Preparing trade finder"
            />
          }
        >
          <LazyBeginnerTradeWizard
            coordinators={coordinators}
            initialCriteria={guidedLaunch?.criteria}
            loading={(loading || refreshing) && orders.length === 0}
            onClose={closeGuidedTrade}
            onCreateOffer={createGuidedOffer}
            onSelectOffer={(order, criteria) => openTakeModal(order, criteria.amount)}
            orders={orders}
            reviewOpen={takeModalOpen}
          />
        </Suspense>
      ) : null}

      {f2fOffersMapOpen ? (
        <Suspense fallback={<F2FOffersMapLoadingDialog onClose={() => setF2FOffersMapOpen(false)} />}>
          <LazyF2FOffersMapDialog
            coordinators={coordinators}
            offers={cashF2FOffers}
            onClose={() => setF2FOffersMapOpen(false)}
            onSelectOffer={(order) => {
              setF2FOffersMapOpen(false);
              openTakeModal(order);
            }}
          />
        </Suspense>
      ) : null}

      {takeModalOpen && selectedOrder ? (
        <TakeOfferModal
          coordinator={selectedCoordinator}
          error={takeError}
          robotUnavailableMessage={takeRobotUnavailableMessage}
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

      {takeRobotPickerOpen ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              title="Preparing your Robot Fleet"
              message="Finding an available robot for this offer."
            />
          }
        >
          <LazyProTakeRobotPicker onClose={() => setTakeRobotPickerOpen(false)} onSelect={selectTakeRobot} />
        </Suspense>
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

      {confirmTakeOpen && takeSlot ? (
        <TokenBackupDialog
          previouslyUsed={
            Boolean(takeSlot.lastOrderId) || Object.values(takeSlot.robots).some((robot) => Boolean(robot.lastOrderId))
          }
          robotName={takeSlot.nickname}
          token={takeSlot.token}
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

function OffersHeadingCopy({
  activeOfferCount,
  cached,
  hasError,
  lastUpdated,
  live,
  nowMs
}: {
  activeOfferCount: number;
  cached: boolean;
  hasError: boolean;
  lastUpdated?: number;
  live: boolean;
  nowMs: number;
}) {
  return (
    <div className="orderbook-heading-copy">
      <div className="orderbook-title-line">
        <CardTitle className="orderbook-title">Public offers</CardTitle>
        {activeOfferCount > 0 ? (
          <span
            className={
              hasError || cached ? "orderbook-live-pill orderbook-live-pill-confirmed" : "orderbook-live-pill"
            }
          >
            <span className="orderbook-live-dot" aria-hidden="true" />
            {hasError ? "Last confirmed" : cached ? "Cached" : live ? "Live" : "Current"}
          </span>
        ) : null}
      </div>
      {activeOfferCount > 0 ? (
        <p className="orderbook-update-context">
          <span>
            {activeOfferCount} {activeOfferCount === 1 ? "offer" : "offers"}
          </span>
          {lastUpdated ? (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={new Date(lastUpdated).toISOString()}>
                Updated {formatOrderbookUpdateAge(lastUpdated, nowMs)}
              </time>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function OfferSkeletonRows() {
  return (
    <>
      {Array.from({ length: 10 }, (_, index) => (
        <div
          className="offer-row offer-row-skeleton"
          key={index}
          style={{ "--offer-row-index": index } as CSSProperties}
          aria-hidden
        >
          <Skeleton className="offer-skeleton-side" />
          <span className="offer-main-cell">
            <Skeleton className="offer-skeleton-amount" />
          </span>
          <Skeleton className="offer-skeleton-short" />
          <Skeleton className="offer-skeleton-method" />
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
    <button
      className={
        active
          ? "offer-table-header-cell offer-sort-button offer-sort-button-active"
          : "offer-table-header-cell offer-sort-button"
      }
      onClick={onClick}
      type="button"
    >
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

function F2FOffersMapLoadingDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      ariaLabel="Loading Cash F2F map"
      onClose={onClose}
      overlayClassName="confirm-overlay f2f-offers-map-overlay"
      panelClassName="confirm-sheet f2f-offers-map-loading-sheet"
    >
      <span className="ui-spinner" aria-hidden="true" />
      <strong>Loading Cash F2F map…</strong>
      <Button onClick={onClose} size="sm" type="button" variant="ghost">
        Cancel
      </Button>
    </Dialog>
  );
}

function F2FLocationLoadingDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      ariaLabel="Loading meeting map"
      onClose={onClose}
      overlayClassName="confirm-overlay f2f-location-overlay"
      panelClassName="confirm-sheet f2f-offers-map-loading-sheet"
    >
      <span className="ui-spinner" aria-hidden="true" />
      <strong>Loading meeting map…</strong>
      <Button onClick={onClose} size="sm" type="button" variant="ghost">
        Cancel
      </Button>
    </Dialog>
  );
}

function TakeOfferModal({
  coordinator,
  error,
  robotUnavailableMessage,
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
  robotUnavailableMessage?: string;
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
  const [showF2FMap, setShowF2FMap] = useState(false);
  const validationErrors = validateTakeOffer(order, takeAmount);
  const passwordMissing = hasPassword && !offerPassword.trim();
  const penaltyDeadline = penalty ? new Date(penalty).getTime() : 0;
  const penaltyActive = Number.isFinite(penaltyDeadline) && penaltyDeadline > Date.now();
  const amountOverride = selectedTakeAmount(order, takeAmount);
  const blockedReason = robotUnavailableMessage
    ? robotUnavailableMessage
    : !coordinator
      ? "Coordinator is not available right now."
      : penaltyActive
        ? `This robot can take another order after ${new Date(penaltyDeadline).toLocaleString()}.`
        : undefined;
  const hasF2FLocation =
    paymentMethodHasF2F(order.payment_method) && hasApproximateF2FLocation(order.latitude, order.longitude);

  return (
    <Dialog
      ariaLabelledby="take-offer-title"
      closeOnEscape={!taking}
      onClose={onClose}
      overlayClassName="take-offer-overlay"
      panelClassName="take-offer-sheet"
    >
      <button className="take-modal-close" onClick={onClose} type="button" aria-label="Close take offer">
        <X size={20} />
      </button>

      <header className="take-offer-header">
        <span
          className={
            isTakerBuying(order) ? "offer-direction offer-direction-buy" : "offer-direction offer-direction-sell"
          }
        >
          <DirectionIcon order={order} />
        </span>
        <div>
          <p className="app-eyebrow">{orderTypeLabel(order)}</p>
          <h2 id="take-offer-title">
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
          icon={<Lock size={14} aria-hidden />}
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
          label={order.is_swap ? "Swap destination" : "Payment Method"}
          value={order.payment_method || "Not specified"}
        />
        <SummaryItem
          help="The order host provides Lightning and communication infrastructure, sets trade fees, and handles disputes."
          label="Coordinator"
          value={coordinator?.longAlias ?? order.coordinatorShortAlias}
        />
      </dl>

      {hasF2FLocation ? (
        <Button className="take-offer-f2f-map" onClick={() => setShowF2FMap(true)} type="button" variant="secondary">
          <MapPin size={16} />
          View approximate meeting area
        </Button>
      ) : null}

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
        <div className="status-panel" hidden={taking}>
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
          disabled={
            Boolean(blockedReason) || validationErrors.length > 0 || passwordMissing || (hasPassword && loadingDetails)
          }
          loading={taking || preparingTake || (hasPassword && loadingDetails)}
          onClick={onTake}
        >
          <ArrowRight size={16} />
          Take offer
        </Button>
      </div>
      {showF2FMap ? (
        <Suspense fallback={<F2FLocationLoadingDialog onClose={() => setShowF2FMap(false)} />}>
          <LazyF2FLocationDialog
            latitude={order.latitude}
            longitude={order.longitude}
            onClose={() => setShowF2FMap(false)}
            readOnly
          />
        </Suspense>
      ) : null}
    </Dialog>
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
    <Dialog
      ariaLabelledby="order-description-title"
      onClose={onBack}
      overlayClassName="confirm-overlay"
      panelClassName="confirm-sheet order-description-sheet"
    >
      <div className="confirm-header">
        <span className="confirm-icon-shell">
          <AlertCircle size={20} />
        </span>
        <div>
          <h3 id="order-description-title">Order description</h3>
          <p className="muted-copy">
            The maker may have included instructions for the trade. Read and understand them before proceeding.
          </p>
        </div>
      </div>
      <blockquote className="order-description-copy">{description}</blockquote>
      <div className="confirm-actions">
        <Button variant="secondary" onClick={onBack}>
          Go back
        </Button>
        <Button onClick={onContinue}>I understand</Button>
      </div>
    </Dialog>
  );
}

function TokenBackupDialog({
  onBack,
  onDone,
  previouslyUsed,
  robotName,
  taking,
  token
}: {
  onBack: () => void;
  onDone: () => void;
  previouslyUsed: boolean;
  robotName: string;
  taking: boolean;
  token: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyToken() {
    try {
      await writeClipboard(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog
      ariaLabelledby="token-backup-title"
      closeOnEscape={!taking}
      onClose={onBack}
      overlayClassName="confirm-overlay token-backup-overlay"
      panelClassName="confirm-sheet token-backup-sheet"
    >
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
      {previouslyUsed ? (
        <div className="token-reuse-note" role="note">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            This is the same robot identity used for an earlier order. Continue with it, or go back and choose a fresh
            robot for stronger privacy separation.
          </span>
        </div>
      ) : null}
      <div className="confirm-actions">
        <Button variant="secondary" disabled={taking} onClick={onBack}>
          Go back
        </Button>
        <Button loading={taking} onClick={onDone}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}

function SummaryItem({ help, icon, label, value }: { help?: string; icon?: ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt>
        {icon}
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

const OfferAmountLine = memo(function OfferAmountLine({ order }: { order: PublicOrder }) {
  return (
    <span className="offer-amount-line">
      <strong className={order.has_range ? "offer-amount-value offer-amount-value-range" : "offer-amount-value"}>
        <FiatAmount order={order} size={18} />
      </strong>
    </span>
  );
});

const OfferMethodLine = memo(function OfferMethodLine({ order }: { order: PublicOrder }) {
  const hasMethodIcon = matchedPaymentMethods(order.payment_method).length > 0;

  return (
    <span className={hasMethodIcon ? "offer-method-line offer-method-line-has-icon" : "offer-method-line"}>
      <PaymentMethodIcons text={order.payment_method} size={22} />
      <span className="offer-method-text">{order.payment_method || "Not specified"}</span>
      {order.is_swap ? <span className="offer-swap-chip">Swap</span> : null}
    </span>
  );
});

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
  const sendDetail = order.is_swap
    ? buying
      ? order.payment_method || "On-chain bitcoin"
      : "Lightning escrow"
    : buying
      ? order.payment_method || "Fiat payment"
      : "Lightning escrow";
  const receiveDetail = order.is_swap
    ? buying
      ? "Bitcoin on-chain"
      : order.payment_method || "On-chain bitcoin"
    : buying
      ? "Bitcoin over Lightning"
      : order.payment_method || "Fiat payment";
  const amountOverride = selectedTakeAmount(order, takeAmount);
  const fiat = <FiatAmount amountOverride={amountOverride} order={order} size={18} />;
  const sats = <BtcAmountPreview amountOverride={amountOverride} coordinator={coordinator} order={order} />;

  return (
    <div className="take-flow-summary" aria-label="Trade preview">
      <TradeFlowCard label="You send" tone="send" value={buying ? fiat : sats} detail={sendDetail} />
      <span className="take-flow-arrow" aria-hidden>
        <ArrowRight size={18} />
      </span>
      <TradeFlowCard label="You receive" tone="receive" value={buying ? sats : fiat} detail={receiveDetail} />
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

function FiatAmount({
  amountOverride,
  order,
  size = 18
}: {
  amountOverride?: number;
  order: PublicOrder;
  size?: number;
}) {
  const { amount, currency } = formatOfferFiatParts(order, amountOverride);

  return (
    <span className="offer-fiat-with-flag">
      <span className="offer-fiat-number">{amount}</span>
      <span className="offer-fiat-unit">
        <span>{currency}</span>
        <CurrencyFlag code={currency} size={size} />
      </span>
    </span>
  );
}

const ExpiryDisplay = memo(function ExpiryDisplay({ expiresAt, nowMs }: { expiresAt?: string; nowMs: number }) {
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
});

const CoordinatorPill = memo(function CoordinatorPill({
  coordinator,
  showName = false
}: {
  coordinator?: CoordinatorSummary;
  showName?: boolean;
}) {
  if (!coordinator) return <span className="coordinator-pill coordinator-pill-muted">?</span>;

  return (
    <span className="coordinator-pill" title={coordinator.longAlias}>
      <img
        className="coordinator-avatar coordinator-avatar-xs"
        src={coordinator.smallAvatarUrl}
        alt=""
        loading="lazy"
      />
      {showName ? <span className="coordinator-pill-name">{coordinator.longAlias}</span> : null}
    </span>
  );
});

function compareOrders(left: PublicOrder, right: PublicOrder, column: SortColumn, direction: SortDirection): number {
  const multiplier = direction === "asc" ? 1 : -1;
  const leftValue = sortValue(left, column);
  const rightValue = sortValue(right, column);

  if (leftValue === rightValue) return orderKey(left).localeCompare(orderKey(right));
  return (leftValue - rightValue) * multiplier;
}

function sortValue(order: PublicOrder, column: SortColumn): number {
  if (column === "amount")
    return knownSatsValue(order.satoshis) ?? knownSatsValue(order.satoshis_now) ?? safeNumber(order.amount);
  if (column === "premium") return safeNumber(order.premium);
  const expiryMs = order.expires_at ? Date.parse(order.expires_at) : Number.POSITIVE_INFINITY;
  return Number.isFinite(expiryMs) ? expiryMs : Number.POSITIVE_INFINITY;
}

function formatOrderbookUpdateAge(updatedAt: number, now: number): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - updatedAt) / 60_000));
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
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

function formatOfferFiatParts(order: PublicOrder, amountOverride?: number): { amount: string; currency: string } {
  const currency = order.currencyCode ?? String(order.currency);
  if (amountOverride != null) return { amount: formatFiat(amountOverride), currency };
  if (order.has_range) {
    return { amount: `${formatFiat(order.min_amount)} - ${formatFiat(order.max_amount)}`, currency };
  }
  return { amount: formatFiat(order.amount), currency };
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
