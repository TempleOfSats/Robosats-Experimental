import { lazy, Suspense, useEffect, useState } from "react";
import { Banknote, ChevronDown, Clock, Copy, MapPin, Tag, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCoordinatorAvatarUrl } from "@/domains/coordinators/coordinatorAssets";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { CoordinatorRating } from "@/domains/coordinators/coordinatorRatings";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { hasApproximateF2FLocation, paymentMethodHasF2F } from "@/domains/location/f2fLocation";
import { AppTransitionDialog } from "@/domains/navigation/AppTransitionFeedback";
import { currencyCodeFromId } from "@/domains/orderbook/currencies";
import { CurrencyFlag, PaymentMethodIcons } from "@/domains/orderbook/OfferMeta";
import { orderReferenceSats, orderReferenceSatsRange } from "@/domains/orders/orderModel";
import type { OrderDto } from "@/domains/orders/order.types";
import { formatFiat, formatSats } from "@/lib/format";
import { writeClipboard } from "@/lib/clipboard";

const LazyF2FLocationDialog = lazy(() =>
  import("@/domains/location/F2FLocationDialog").then((module) => ({ default: module.F2FLocationDialog }))
);
const LazyCoordinatorDetailDialog = lazy(() =>
  import("@/domains/coordinators/CoordinatorsPage").then((module) => ({ default: module.CoordinatorDetailDialog }))
);

export function OrderEyebrow({ order }: { order: OrderDto }) {
  const currencyCode = currencyCodeFromId(order.currency) ?? String(order.currency);
  return (
    <p className="app-eyebrow trade-order-eyebrow">
      <span>Order #{order.id || "preview"}</span>
      <span aria-hidden="true">·</span>
      <small className="trade-order-summary-order">
        {formatOrderAmount(order, currencyCode)} · {order.payment_method || "Method not specified"}
      </small>
    </p>
  );
}

export function OrderDetailsPanel({
  coordinator,
  coordinatorAlias,
  defaultOpen,
  order,
  robotHashId,
  robotName
}: {
  coordinator?: CoordinatorSummary;
  coordinatorAlias: string;
  defaultOpen: boolean;
  order: OrderDto;
  robotHashId: string;
  robotName: string;
}) {
  const currencyCode = currencyCodeFromId(order.currency) ?? String(order.currency);
  const fiatAmount = formatOrderAmount(order, currencyCode);
  const satsAmount = formatOrderSats(order);
  const sendReceive = tradeSendReceive(order, fiatAmount, satsAmount);
  const expiresAt = new Date(order.expires_at);
  const expiryText = Number.isNaN(expiresAt.getTime())
    ? "soon"
    : expiresAt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const showExpiry = ![4, 5, 12, 13, 14, 15, 16, 17, 18].includes(order.status);
  const paymentShowsExpiry =
    (Boolean(order.bond_invoice) && (order.status === 0 || order.status === 3)) ||
    (Boolean(order.escrow_invoice) && (order.status === 6 || order.status === 7));
  const coordinatorName =
    coordinator?.longAlias || coordinator?.shortAlias || order.shortAlias || coordinatorAlias || "Coordinator";
  const hostName = coordinatorName || "Coordinator";
  const coordinatorAvatar =
    coordinator?.smallAvatarUrl || (coordinatorAlias ? getCoordinatorAvatarUrl(coordinatorAlias, "small") : "");
  const coordinatorTradeUrl = coordinator?.url
    ? `${coordinator.url.trim().replace(/\/+$/, "")}/trade/${order.id}`
    : window.location.href;
  const preferenceKey = `robosats_order_details_${coordinatorAlias}_${order.id}_${order.status}`;
  const [detailsOpen, setDetailsOpen] = useState(() => readOrderDetailsPreference(preferenceKey, defaultOpen));
  const [showF2FMap, setShowF2FMap] = useState(false);
  const hasF2FLocation =
    paymentMethodHasF2F(order.payment_method) && hasApproximateF2FLocation(order.latitude, order.longitude);

  useEffect(() => {
    setDetailsOpen(readOrderDetailsPreference(preferenceKey, defaultOpen));
  }, [defaultOpen, preferenceKey]);

  const handleToggle = (open: boolean) => {
    setDetailsOpen(open);
    writeOrderDetailsPreference(preferenceKey, open);
  };

  return (
    <Card className="trade-order-card">
      <div className="trade-order-context">
        <div className="trade-order-user">
          <RobotAvatar hashId={robotHashId || robotName} label={robotName} size="sm" />
          <span>
            <small>Your robot</small>
            <strong>{robotName}</strong>
          </span>
        </div>
        <span className="trade-order-number">
          <small>Order</small>
          <strong>#{order.id || "-"}</strong>
        </span>
      </div>
      <details
        className="trade-order-disclosure"
        open={detailsOpen}
        onToggle={(event) => handleToggle(event.currentTarget.open)}
      >
        <summary className="trade-order-summary">
          <span className="trade-order-summary-copy">
            <strong>Order details</strong>
            <span className="trade-order-summary-meta">
              <small className="trade-order-summary-order">
                {fiatAmount} · {order.payment_method || "Method not specified"}
              </small>
              {showExpiry && !paymentShowsExpiry ? (
                <small className="trade-order-summary-expiry">
                  <Clock size={12} aria-hidden="true" />
                  Expires {expiryText}
                </small>
              ) : null}
            </span>
          </span>
          <ChevronDown className="trade-order-summary-chevron" size={18} aria-hidden="true" />
        </summary>
        <CardContent>
          <CoordinatorHost coordinator={coordinator} coordinatorName={hostName} coordinatorAvatar={coordinatorAvatar} />

          <dl className="trade-detail-list">
            <div>
              <dt>Amount</dt>
              <dd className="trade-detail-amount">
                <CurrencyFlag code={currencyCode} size={20} />
                <span className="amount-mono">{fiatAmount}</span>
              </dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd className="trade-detail-method">
                <PaymentMethodIcons text={order.payment_method} size={20} />
                <span>{order.payment_method || "Not specified"}</span>
              </dd>
            </div>
            <div>
              <dt>Premium</dt>
              <dd>{Number.isFinite(Number(order.premium)) ? `${Number(order.premium).toFixed(2)}%` : "-"}</dd>
            </div>
          </dl>

          {hasF2FLocation ? (
            <Button
              className="trade-f2f-map-button"
              onClick={() => setShowF2FMap(true)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <MapPin size={15} />
              View approximate meeting area
            </Button>
          ) : null}

          <div className="trade-flow-lines">
            <div className="trade-flow-line trade-flow-line-send">
              {order.is_buyer ? (
                <Banknote className="trade-flow-icon-fiat" size={18} aria-hidden="true" />
              ) : (
                <Zap className="trade-flow-icon-lightning" size={18} aria-hidden="true" />
              )}
              <span>{sendReceive.send}</span>
            </div>
            <div className="trade-flow-line trade-flow-line-receive">
              {order.is_buyer ? (
                <Zap className="trade-flow-icon-lightning" size={18} aria-hidden="true" />
              ) : (
                <Banknote className="trade-flow-icon-fiat" size={18} aria-hidden="true" />
              )}
              <span>{sendReceive.receive}</span>
            </div>
          </div>

          {order.description ? (
            <details className="invoice-details">
              <summary>Offer description</summary>
              <p className="muted-copy">{order.description}</p>
            </details>
          ) : null}
          <Button
            className="trade-copy-link"
            size="sm"
            variant="ghost"
            onClick={() => void writeClipboard(coordinatorTradeUrl).catch(() => undefined)}
          >
            <Copy size={14} /> Copy order link
          </Button>
        </CardContent>
      </details>
      {showF2FMap ? (
        <Suspense
          fallback={
            <AppTransitionDialog title="Preparing meeting map" message="Loading the approximate meeting area..." />
          }
        >
          <LazyF2FLocationDialog
            latitude={order.latitude}
            longitude={order.longitude}
            onClose={() => setShowF2FMap(false)}
            readOnly
          />
        </Suspense>
      ) : null}
    </Card>
  );
}

function CoordinatorHost({
  coordinator,
  coordinatorAvatar,
  coordinatorName
}: {
  coordinator?: CoordinatorSummary;
  coordinatorAvatar: string;
  coordinatorName: string;
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<CoordinatorRating>({ score: 0, count: 0 });
  const lastRefreshed = useFederationStore((state) => state.lastRefreshed);
  const network = useFederationStore((state) => state.network);

  function showDetails() {
    if (!coordinator) return;
    setOpen(true);
    setRating({ score: 0, count: 0 });
    void import("@/domains/coordinators/coordinatorRatings")
      .then(({ fetchCoordinatorRatings }) => fetchCoordinatorRatings([coordinator]))
      .then((ratings) => setRating(ratings[coordinator.shortAlias] ?? { score: 0, count: 0 }))
      .catch(() => undefined);
  }

  if (!coordinator) {
    return (
      <div className="trade-order-host">
        {coordinatorAvatar ? (
          <img className="trade-order-host-avatar" src={coordinatorAvatar} alt="" />
        ) : (
          <span className="trade-order-host-avatar">
            <Tag size={18} />
          </span>
        )}
        <div>
          <strong>{coordinatorName}</strong>
          <p>Order host</p>
        </div>
      </div>
    );
  }
  return (
    <>
      <button
        className="trade-order-host trade-order-host-button"
        type="button"
        onClick={showDetails}
        aria-label={`View ${coordinatorName} coordinator details`}
      >
        {coordinatorAvatar ? (
          <img className="trade-order-host-avatar" src={coordinatorAvatar} alt="" />
        ) : (
          <span className="trade-order-host-avatar">
            <Tag size={18} />
          </span>
        )}
        <span>
          <strong>{coordinatorName}</strong>
          <small>Order host</small>
        </span>
      </button>
      {open ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              title="Preparing coordinator details"
              message={`Loading ${coordinatorName}...`}
              onClose={() => setOpen(false)}
            />
          }
        >
          <LazyCoordinatorDetailDialog
            compact
            coordinator={coordinator}
            lastRefreshed={lastRefreshed}
            network={network}
            rating={rating}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export function shouldOpenOrderDetailsByDefault(order: Pick<OrderDto, "status" | "is_maker">): boolean {
  return [7, 8].includes(order.status) || ([1, 2].includes(order.status) && order.is_maker);
}

function readOrderDetailsPreference(key: string, fallback: boolean): boolean {
  try {
    const preference = window.sessionStorage.getItem(key);
    if (preference === null) return fallback;
    return preference === "open";
  } catch {
    return fallback;
  }
}

function writeOrderDetailsPreference(key: string, open: boolean): void {
  try {
    window.sessionStorage.setItem(key, open ? "open" : "closed");
  } catch {
    // The disclosure still works when storage is unavailable.
  }
}

function tradeSendReceive(order: OrderDto, fiatAmount: string, satsAmount: string): { send: string; receive: string } {
  if (order.is_buyer) {
    return {
      send: `You send via ${order.payment_method || "the agreed method"} ${fiatAmount}`,
      receive: `You receive ${satsAmount}`
    };
  }

  return {
    send: `You send via Lightning ${satsAmount}`,
    receive: `You receive via ${order.payment_method || "the agreed method"} ${fiatAmount}`
  };
}

function formatOrderAmount(order: OrderDto, currencyCode: string): string {
  const hasUnselectedRange = order.has_range && !(typeof order.amount === "number" && order.amount > 0);
  if (hasUnselectedRange && order.min_amount && order.max_amount) {
    if (order.currency === 1000) {
      return formatSatsRange(Math.round(order.min_amount * 100_000_000), Math.round(order.max_amount * 100_000_000));
    }
    return `${formatFiat(order.min_amount)} - ${formatFiat(order.max_amount, currencyCode)}`;
  }

  return order.currency === 1000
    ? formatSats(Math.round((order.amount ?? 0) * 100_000_000))
    : formatFiat(order.amount, currencyCode);
}

function formatOrderSats(order: OrderDto): string {
  const range = orderReferenceSatsRange(order);
  if (range) return `Approx. ${formatSatsRange(range.minimum, range.maximum)}`;

  const sats = orderReferenceSats(order);
  return `Approx. ${formatSats(sats)}`;
}

function formatSatsRange(minimum: number, maximum: number): string {
  const formatter = new Intl.NumberFormat();
  return `${formatter.format(minimum)} - ${formatter.format(maximum)} sats`;
}
