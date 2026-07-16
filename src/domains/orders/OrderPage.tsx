import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Banknote, Check, ChevronDown, Clock, Copy, Download, ExternalLink, FileText, Link2, Paperclip, Rocket, ShieldAlert, Star, Tag, WifiOff, AlertTriangle, XCircle, Zap } from "lucide-react";
import { playTradeAudio } from "@/domains/audio/audioController";
import { tradeAudioEventForOrderTransition } from "@/domains/audio/audioAssets";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import type { CoordinatorContact, CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { getCoordinatorAvatarUrl } from "@/domains/coordinators/coordinatorAssets";
import { CurrencyFlag, PaymentMethodIcons } from "@/domains/orderbook/OfferMeta";
import { currencyCodeFromId } from "@/domains/orderbook/currencies";
import {
  getRobotAuthForCoordinator,
  selectCurrentSlot,
  type RobotRecord,
  type RobotSlot,
  useGarageStore
} from "@/domains/garage/garageStore";
import { ChatStagePanel } from "@/domains/chat/ChatStagePanel";
import { signCleartextMessage } from "@/domains/crypto/pgp";
import { getTradeActionCommands, type TradeActionCommand } from "@/domains/orders/orderActions";
import { getTradeViewState } from "@/domains/orders/orderStateMachine";
import { useOrderStore } from "@/domains/orders/orderStore";
import { tradePreviewOrder } from "@/domains/orders/tradePreviewFixtures";
import { isOrderReferenceSatsApproximate, orderReferenceSats, orderReferenceSatsRange } from "@/domains/orders/orderModel";
import type { OrderDto, SubmitOrderActionPayload } from "@/domains/orders/order.types";
import type { CreateOrderDraft } from "@/domains/maker/maker.types";
import type { Auth } from "@/domains/transport/apiClient";
import { tradeMotionClass } from "@/domains/motion/tradeMotion";
import { PaymentQrCard } from "@/domains/payments/PaymentQrCard";
import { lightningPayoutAmount, lightningRoutingBudgetSats, onchainPayoutBreakdown } from "@/domains/payments/payoutAmounts";
import { availableLnProxyServers, wrapLnProxyInvoice } from "@/domains/payments/lnProxy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFiat, formatSats } from "@/lib/format";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { requestReviewToken } from "@/domains/reviews/reviewApi";
import { publishCoordinatorRating } from "@/domains/coordinators/coordinatorRatings";
import { fetchChatMessages } from "@/domains/chat/chatApi";
import { decryptChatMessage } from "@/domains/chat/chatCrypto";
import { toUserMessage } from "@/lib/userError";

export function OrderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const params = useParams();
  const shortAlias = params.shortAlias ?? "local";
  const orderId = Number(params.orderId ?? 0);
  const coordinators = useFederationStore((state) => state.coordinators);
  const slots = useGarageStore((state) => state.slots);
  const currentToken = useGarageStore((state) => state.currentToken);
  const hydrateGarage = useGarageStore((state) => state.hydrate);
  const { order: loadedOrder, submitting, error, loadOrder, submitAction, clearOrder } = useOrderStore();
  const currentSlot = selectCurrentSlot(slots, currentToken);
  const coordinator = coordinators.find((item) => item.shortAlias === shortAlias) ?? coordinators.find((item) => item.shortAlias === "local");
  const coordinatorAuth = coordinator ? getRobotAuthForCoordinator(currentSlot, coordinator.shortAlias) : undefined;
  const signingRobot = getSigningRobot(currentSlot, shortAlias);
  const previousStatus = useRef<number | undefined>(undefined);
  const previousWasTaker = useRef(false);
  const tradeLabEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_TRADE_LAB === "true";
  const previewScenario = tradeLabEnabled ? searchParams.get("tradePreview") : null;
  const previewOrder = tradeLabEnabled ? tradePreviewOrder(previewScenario) : undefined;
  const [previewNotice, setPreviewNotice] = useState("");

  useEffect(() => {
    hydrateGarage();
  }, [hydrateGarage]);

  useEffect(() => {
    if (previewOrder) return;
    clearOrder();
    previousStatus.current = undefined;
    previousWasTaker.current = false;
  }, [clearOrder, orderId, previewOrder, shortAlias]);

  useEffect(() => {
    if (previewOrder) return;
    if (!coordinator || !orderId) return;
    void loadOrder({ coordinator, orderId, slot: currentSlot });
  }, [coordinator, currentSlot?.token, loadOrder, orderId, previewOrder]);

  useEffect(() => {
    if (previewOrder) return;
    if (!loadedOrder || !coordinator || !currentSlot || !orderId) return;

    let timer: number | undefined;
    let disposed = false;
    const schedule = () => {
      if (disposed) return;
      const multiplier = document.hidden ? 5 : 1;
      timer = window.setTimeout(async () => {
        await loadOrder({ coordinator, orderId, slot: currentSlot });
        if (disposed) return;
        schedule();
      }, orderRefreshDelayMs(loadedOrder.status, loadedOrder.tx_queued) * multiplier);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        if (timer !== undefined) window.clearTimeout(timer);
        schedule();
        return;
      }
      refreshNow();
    };
    const refreshNow = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      void loadOrder({ coordinator, orderId, slot: currentSlot }).finally(() => {
        if (!disposed) schedule();
      });
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("robosats:native-resume", refreshNow);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("robosats:native-resume", refreshNow);
    };
  }, [coordinator, currentSlot?.token, loadedOrder?.status, loadOrder, orderId, previewOrder]);

  useEffect(() => {
    if (!loadedOrder) return;
    const lastStatus = previousStatus.current;
    const wasTaker = previousWasTaker.current;
    previousStatus.current = loadedOrder.status;
    previousWasTaker.current = loadedOrder.is_taker;
    if (!previewOrder) {
      const audioEvent = tradeAudioEventForOrderTransition(lastStatus, loadedOrder.status);
      if (audioEvent) void playTradeAudio(audioEvent).catch(() => undefined);
    }
    if (!previewOrder && lastStatus !== undefined && ![4, 12].includes(lastStatus) && [4, 12].includes(loadedOrder.status)) {
      navigate("/offers", { replace: true });
      return;
    }
    if (!previewOrder && shouldReturnExpiredTakeToOffers(lastStatus, wasTaker, loadedOrder)) {
      navigate("/offers", { replace: true });
      return;
    }
  }, [loadedOrder, navigate, previewOrder]);

  const visibleOrder = previewOrder ?? loadedOrder;

  useEffect(() => {
    setPreviewNotice("");
  }, [previewOrder?.status, searchParams]);

  if (!visibleOrder) {
    return (
      <main className="page page-trade">
        <div className="page-heading">
          <div>
            <p className="app-eyebrow">Order #{orderId || "-"}</p>
            <h2>Loading trade</h2>
            <p>Fetching the private contract state from {shortAlias}.</p>
          </div>
        </div>
        {error ? (
          <div className="status-panel status-panel-warning order-error-panel">
            <WifiOff size={18} />
            <span>{error}</span>
          </div>
        ) : (
          <div className="trade-loading" aria-label="Loading trade">
            <div className="trade-loading-progress" aria-hidden>
              {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} />)}
            </div>
            <section className="trade-loading-card trade-loading-card-primary" aria-hidden>
              <Skeleton className="trade-loading-card-title" />
              <Skeleton className="trade-loading-card-line" />
              <Skeleton className="trade-loading-card-line trade-loading-card-line-short" />
              <Skeleton className="trade-loading-card-action" />
            </section>
            <section className="trade-loading-card trade-loading-card-details" aria-hidden>
              <div>
                <Skeleton className="trade-loading-detail-title" />
                <Skeleton className="trade-loading-detail-copy" />
              </div>
              <Skeleton className="trade-loading-detail-chevron" />
            </section>
          </div>
        )}
      </main>
    );
  }

  const order = visibleOrder;
  if (!previewOrder && order.status === 1 && !order.is_maker && !order.is_taker) {
    return <Navigate replace to="/offers" />;
  }
  const view = getTradeViewState(order);
  const motionClass = tradeMotionClass(view);
  const actions = getTradeActionCommands(order, view);
  const isPayoutRoutingState = view.panel === "sending_sats" || view.panel === "routing_failed";
  const isQuietPaymentState = view.panel === "sending_sats" || view.panel === "routing_failed" || view.panel === "success";

  return (
    <main className={`page page-trade${isPayoutRoutingState ? " page-trade-routing" : ""}`}>
      {!isQuietPaymentState ? (
        <div className="page-heading">
          <div>
            <p className="app-eyebrow">Order #{order.id || "preview"}</p>
            <h2>{view.title}</h2>
          </div>
          {view.tone === "danger" ? (
            <Badge tone="danger">
              <XCircle size={12} />
              {tradeStatusLabel(order)}
            </Badge>
          ) : null}
        </div>
      ) : null}

      <TradeProgress order={order} />

      {error ? (
        <div className="status-panel status-panel-warning order-error-panel">
          <WifiOff size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {previewNotice ? (
        <div className="status-panel trade-preview-notice" role="status">
          <Check size={18} />
          <span>{previewNotice}</span>
        </div>
      ) : null}

      <section className={`trade-layout trade-main-layout ${motionClass}`}>
        <div className="trade-panel-slot">
          <ContractPanel
            actions={actions}
            canSubmit={Boolean(previewOrder || (loadedOrder && coordinator && currentSlot))}
            chatAuth={previewOrder ? undefined : coordinatorAuth}
            coordinatorUrl={previewOrder ? undefined : coordinator?.url}
            coordinatorContact={previewOrder ? { email: "fixture", telegram: "fixture", simplex: "fixture", nostr: "fixture" } : coordinator?.contact}
            loading={submitting}
            myNick={getCurrentRobotNick(order)}
            order={order}
            previewMode={Boolean(previewOrder)}
            previewTrustPrompt={previewScenario === "trust-coordinator"}
            signingRobot={previewOrder ? undefined : signingRobot}
            slotToken={previewOrder ? undefined : currentSlot?.token}
            view={view}
            onRenew={() => previewOrder
              ? setPreviewNotice("Renew offer simulated locally. No route change or request was made.")
              : navigate("/create", { state: { renewDraft: renewalDraft(order), shortAlias } })}
            onStartAgain={() => previewOrder
              ? setPreviewNotice("Start again simulated locally. No route change was made.")
              : navigate("/create")}
            onPublishRating={previewOrder || !coordinator || !coordinatorAuth || !currentSlot ? undefined : async (rating) => {
              const identity = deriveRobotIdentity(currentSlot.token);
              const review = await requestReviewToken(coordinator.url, identity.nostrPubKey, coordinatorAuth);
              if (!review.token) throw new Error("Coordinator did not issue a review token.");
              await submitAction({ coordinator, orderId: order.id, slot: currentSlot, payload: { action: "rate_platform", rating } });
              await publishCoordinatorRating({ coordinator, orderId: order.id, rating, reviewToken: review.token, secretKey: identity.nostrSecKey });
            }}
            onSubmitAction={async (payload) => {
              if (previewOrder) {
                setPreviewNotice(`${previewActionLabel(payload.action)} simulated locally. No request was sent.`);
                return;
              }
              if (!coordinator || !currentSlot) return;
              await submitAction({ coordinator, orderId: order.id, slot: currentSlot, payload });
            }}
            onSubmitCommand={(action) => {
              if (previewOrder) {
                setPreviewNotice(`${action.label} simulated locally. No request was sent.`);
                return;
              }
              if (!coordinator || !currentSlot || !action.payload) return;
              void submitAction({ coordinator, orderId: order.id, slot: currentSlot, payload: action.payload }).then(() => {
                const updated = useOrderStore.getState();
                if (!updated.error && shouldLeaveTradeAfterAction(action.key, updated.order)) {
                  navigate("/offers", { replace: true });
                }
              });
            }}
            onSubmitPayout={async (payload) => {
              if (previewOrder) {
                setPreviewNotice(`${previewActionLabel(payload.action)} simulated locally. No request was sent.`);
                return;
              }
              if (!coordinator || !currentSlot) return;
              await submitAction({ coordinator, orderId: order.id, slot: currentSlot, payload });
            }}
          />
        </div>

        {!isQuietPaymentState ? (
          <div className="trade-panel-slot">
            <OrderDetailsPanel coordinator={coordinator} coordinatorAlias={shortAlias} order={order} />
          </div>
        ) : null}
      </section>
    </main>
  );
}

function tradeStatusLabel(order: OrderDto): string {
  const labels: Record<number, string> = {
    0: "Publishing",
    1: "Waiting for taker",
    2: "Taker found",
    3: "Awaiting bond",
    4: "Cancelled",
    5: "Expired",
    6: "Setup in progress",
    7: "Setup in progress",
    8: "Setup in progress",
    9: "Sending fiat",
    10: "Fiat sent",
    11: "In dispute",
    12: "Collaboratively cancelled",
    13: "Sending payout",
    14: "Trade complete",
    15: "Payout retry",
    16: "Under review",
    17: "Dispute resolved",
    18: "Dispute resolved"
  };
  return labels[order.status] ?? order.status_message ?? "Trade active";
}

export function orderRefreshDelayMs(status: number, txQueued = false): number {
  if (status === 14 && txQueued) return 5_000;
  const delays: Record<number, number> = {
    0: 3_000,
    1: 35_000,
    2: 180_000,
    3: 3_000,
    4: 999_999,
    5: 999_999,
    6: 8_000,
    7: 8_000,
    8: 8_000,
    9: 10_000,
    10: 10_000,
    11: 100_000,
    12: 999_999,
    13: 10_000,
    14: 60_000,
    15: 30_000,
    16: 300_000,
    17: 300_000,
    18: 300_000
  };
  return delays[status] ?? 5_000;
}

export function shouldReturnExpiredTakeToOffers(
  lastStatus: number | undefined,
  wasTaker: boolean,
  order: Pick<OrderDto, "status" | "is_maker">
): boolean {
  return lastStatus === 3 && wasTaker && order.status === 1 && !order.is_maker;
}

export function shouldLeaveTradeAfterAction(
  actionKey: string,
  order?: Pick<OrderDto, "status" | "is_maker" | "is_taker">
): boolean {
  if (!["cancel", "collaborative-cancel"].includes(actionKey) || !order) return false;
  return [4, 12].includes(order.status)
    || (order.status === 1 && !order.is_maker && !order.is_taker);
}

function previewActionLabel(action?: string): string {
  if (!action) return "Action";
  return action
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ContractPanel({
  actions,
  canSubmit,
  chatAuth,
  coordinatorUrl,
  coordinatorContact,
  loading,
  myNick,
  order,
  previewMode,
  previewTrustPrompt,
  signingRobot,
  slotToken,
  view,
  onSubmitAction,
  onSubmitCommand,
  onSubmitPayout,
  onRenew,
  onStartAgain,
  onPublishRating
}: {
  actions: TradeActionCommand[];
  canSubmit: boolean;
  chatAuth?: Auth;
  coordinatorUrl?: string;
  coordinatorContact?: CoordinatorContact;
  loading: boolean;
  myNick: string;
  order: OrderDto;
  previewMode: boolean;
  previewTrustPrompt: boolean;
  signingRobot?: RobotRecord;
  slotToken?: string;
  view: ReturnType<typeof getTradeViewState>;
  onSubmitAction: (payload: SubmitOrderActionPayload) => Promise<void>;
  onSubmitCommand: (action: TradeActionCommand) => void;
  onSubmitPayout: (payload: SubmitOrderActionPayload) => Promise<void>;
  onRenew: () => void;
  onStartAgain: () => void;
  onPublishRating?: (rating: number) => Promise<void>;
}) {
  const isInvoicePaymentStep = view.requiredAction === "pay_bond" || view.requiredAction === "pay_escrow";
  const isChatStep = view.panel === "chat";
  const isDisputeStep = view.panel === "dispute_statement";
  const isPayoutStep = view.requiredAction === "submit_payout" || view.requiredAction === "retry_invoice";
  const isSuccessStep = view.panel === "success";
  const isRoutingStep = view.panel === "sending_sats" || view.panel === "routing_failed";

  return (
    <div className="trade-contract-stack">
      {!isInvoicePaymentStep && !isChatStep && !isDisputeStep && !isPayoutStep && !isSuccessStep && !isRoutingStep ? (
        <Card className="trade-contract-card">
          <CardHeader className="trade-contract-title-row">
            <CardTitle>{view.message.heading}</CardTitle>
          </CardHeader>
          <CardContent>
            {order.pending_cancel ? (
              <div className="status-panel status-panel-warning trade-cancel-notice">
                <AlertTriangle size={18} />
                <span>Your peer requested collaborative cancellation. Accept only if both of you agreed in chat.</span>
              </div>
            ) : order.asked_for_cancel ? (
              <div className="status-panel trade-cancel-notice">
                <Clock size={18} />
                <span>Your collaborative cancellation request is waiting for your peer.</span>
              </div>
            ) : null}
            <div className="trade-action trade-action-status">
              <ShieldAlert size={22} />
              <p>{view.message.body}</p>
            </div>
            <TradeActionSurface actions={actions} canSubmit={canSubmit} loading={loading} onSubmit={onSubmitCommand} />
          </CardContent>
        </Card>
      ) : null}

      <TradePaymentPanel
        canSubmit={canSubmit}
        chatAuth={chatAuth}
        coordinatorUrl={coordinatorUrl}
        coordinatorContact={coordinatorContact}
        loading={loading}
        myNick={myNick}
        order={order}
        previewMode={previewMode}
        previewTrustPrompt={previewTrustPrompt}
        signingRobot={signingRobot}
        slotToken={slotToken}
        onRenew={onRenew}
        onStartAgain={onStartAgain}
        onPublishRating={onPublishRating}
        footer={isInvoicePaymentStep && actions.length > 0 ? (
          <TradeActionSurface actions={actions} canSubmit={canSubmit} loading={loading} onSubmit={onSubmitCommand} />
        ) : undefined}
        onSubmitAction={onSubmitAction}
        onSubmitPayout={onSubmitPayout}
      />
      {isChatStep ? (
        <ChatTradeActions
          actions={actions}
          canSubmit={canSubmit}
          loading={loading}
          order={order}
          onSubmit={onSubmitCommand}
        />
      ) : null}
    </div>
  );
}

function ChatTradeActions({
  actions,
  canSubmit,
  loading,
  order,
  onSubmit
}: {
  actions: TradeActionCommand[];
  canSubmit: boolean;
  loading: boolean;
  order: OrderDto;
  onSubmit: (action: TradeActionCommand) => void;
}) {
  const primaryActions = actions.filter((action) => ["confirm-fiat-sent", "confirm-fiat-received", "undo-confirm"].includes(action.key));
  const optionActions = actions.filter((action) => !primaryActions.includes(action));

  return (
    <div className="chat-trade-actions">
      {order.pending_cancel ? (
        <div className="status-panel status-panel-warning trade-cancel-notice">
          <AlertTriangle size={18} />
          <span>Your peer requested collaborative cancellation.</span>
        </div>
      ) : order.asked_for_cancel ? (
        <div className="status-panel trade-cancel-notice">
          <Clock size={18} />
          <span>Waiting for your peer to accept cancellation.</span>
        </div>
      ) : null}
      <TradeActionSurface actions={primaryActions} canSubmit={canSubmit} loading={loading} onSubmit={onSubmit} />
      {optionActions.length > 0 ? (
        <details className="chat-trade-options">
          <summary>Trade options</summary>
          <TradeActionSurface actions={optionActions} canSubmit={canSubmit} loading={loading} onSubmit={onSubmit} />
        </details>
      ) : null}
    </div>
  );
}

function OrderDetailsPanel({ coordinator, coordinatorAlias, order }: { coordinator?: CoordinatorSummary; coordinatorAlias: string; order: OrderDto }) {
  const currencyCode = currencyCodeFromId(order.currency) ?? String(order.currency);
  const fiatAmount = formatOrderAmount(order, currencyCode);
  const satsAmount = formatOrderSats(order);
  const sendReceive = tradeSendReceive(order, fiatAmount, satsAmount);
  const expiresAt = new Date(order.expires_at);
  const showExpiry = ![4, 5, 12, 13, 14, 15, 16, 17, 18].includes(order.status);
  const paymentShowsExpiry =
    (Boolean(order.bond_invoice) && (order.status === 0 || order.status === 3)) ||
    (Boolean(order.escrow_invoice) && (order.status === 6 || order.status === 7));
  const coordinatorName = coordinator?.longAlias || coordinator?.shortAlias || order.shortAlias || coordinatorAlias || "Coordinator";
  const coordinatorAvatar = coordinator?.smallAvatarUrl || (coordinatorAlias ? getCoordinatorAvatarUrl(coordinatorAlias, "small") : "");
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setDetailsOpen(false);
  }, [order.id]);

  return (
    <Card className="trade-order-card">
      <details
        className="trade-order-disclosure"
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <summary className="trade-order-summary">
          <span className="trade-order-summary-copy">
            <strong>Order details</strong>
            <small>{fiatAmount} · {order.payment_method || "Method not specified"}</small>
          </span>
          <ChevronDown className="trade-order-summary-chevron" size={18} aria-hidden="true" />
        </summary>
        <CardContent>
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

        {showExpiry && !paymentShowsExpiry ? (
          <div className="trade-time-box">
            <div>
              <Clock size={18} />
              <span>Expires {Number.isNaN(expiresAt.getTime()) ? "soon" : expiresAt.toLocaleString()}</span>
            </div>
          </div>
        ) : null}
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
          onClick={() => navigator.clipboard?.writeText(window.location.href)}
        >
          <Copy size={14} /> Copy order link
        </Button>
        </CardContent>
      </details>
    </Card>
  );
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
  return `${isOrderReferenceSatsApproximate(order) ? "Approx. " : ""}${formatSats(sats)}`;
}

function formatSatsRange(minimum: number, maximum: number): string {
  const formatter = new Intl.NumberFormat();
  return `${formatter.format(minimum)} - ${formatter.format(maximum)} sats`;
}

function TradeActionSurface({
  actions,
  canSubmit,
  loading,
  onSubmit
}: {
  actions: TradeActionCommand[];
  canSubmit: boolean;
  loading: boolean;
  onSubmit: (action: TradeActionCommand) => void;
}) {
  const [pendingAction, setPendingAction] = useState<TradeActionCommand | null>(null);
  const orderedActions = [...actions].sort((left, right) => actionPriority(left.key) - actionPriority(right.key));

  if (actions.length === 0) {
    return null;
  }

  const criticalActions = [
    "cancel",
    "collaborative-cancel",
    "confirm-fiat-sent",
    "confirm-fiat-received",
    "undo-confirm",
    "open-dispute"
  ];

  const handleActionClick = (action: TradeActionCommand) => {
    if (criticalActions.includes(action.key) && action.payload) {
      setPendingAction(action);
    } else {
      onSubmit(action);
    }
  };

  const handleConfirm = () => {
    if (pendingAction) {
      onSubmit(pendingAction);
      setPendingAction(null);
    }
  };

  const handleCancel = () => {
    setPendingAction(null);
  };

  return (
    <>
      <div className="trade-action-surface">
        {orderedActions.map((action) => {
          const disabledReason = action.disabledReason ?? (!canSubmit ? "Load a live order with an active robot first" : undefined);
          const isCritical = criticalActions.includes(action.key);
          return (
            <div className={`trade-action-command trade-action-command-${action.key}`} key={action.key}>
              <Button
                className="full-width"
                variant={action.variant}
                loading={loading && Boolean(action.payload)}
                disabled={Boolean(disabledReason) || !action.payload}
                title={disabledReason ?? action.description}
                onClick={() => handleActionClick(action)}
              >
                {action.label}
                {isCritical ? <AlertTriangle size={14} /> : null}
              </Button>
              {disabledReason ? <p className="muted-copy">{disabledReason}</p> : null}
            </div>
          );
        })}
      </div>

      {/* Review and confirm dialog for critical actions */}
      {pendingAction && (
        <div className="confirm-overlay" onClick={handleCancel} role="dialog" aria-modal="true" aria-label="Confirm action">
          <div className="confirm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-header">
              <div className="confirm-icon-shell">
                <AlertTriangle size={24} />
              </div>
              <h3>{pendingAction.label}?</h3>
            </div>
            <p className="confirm-body">{pendingAction.description}</p>
            <div className="confirm-actions">
              <Button variant="secondary" onClick={handleCancel} type="button">
                Cancel
              </Button>
              <Button
                variant={pendingAction.variant === "destructive" ? "destructive" : "primary"}
                onClick={handleConfirm}
                type="button"
              >
                <Check size={16} />
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function actionPriority(key: string): number {
  if (key.startsWith("confirm-") || key === "undo-confirm") return 0;
  if (key === "cancel") return 1;
  if (key === "open-dispute") return 2;
  return 1;
}

function TradePaymentPanel({
  canSubmit,
  chatAuth,
  coordinatorUrl,
  coordinatorContact,
  loading,
  myNick,
  order,
  previewMode,
  previewTrustPrompt,
  footer,
  signingRobot,
  slotToken,
  onRenew,
  onStartAgain,
  onPublishRating,
  onSubmitAction,
  onSubmitPayout
}: {
  canSubmit: boolean;
  chatAuth?: Auth;
  coordinatorUrl?: string;
  coordinatorContact?: CoordinatorContact;
  loading: boolean;
  myNick: string;
  order: OrderDto;
  previewMode: boolean;
  previewTrustPrompt: boolean;
  footer?: ReactNode;
  signingRobot?: RobotRecord;
  slotToken?: string;
  onRenew: () => void;
  onStartAgain: () => void;
  onPublishRating?: (rating: number) => Promise<void>;
  onSubmitAction: (payload: SubmitOrderActionPayload) => Promise<void>;
  onSubmitPayout: (payload: SubmitOrderActionPayload) => Promise<void>;
}) {
  const view = getTradeViewState(order);
  const trustKey = `robosats_trusted_coordinator_${order.shortAlias || "unknown"}`;
  const [coordinatorAcknowledged, setCoordinatorAcknowledged] = useState(() => previewTrustPrompt ? false : !coordinatorUrl || localStorage.getItem(trustKey) === "true");

  if (
    [
      "public_order",
      "paused_order",
      "taker_found",
      "escrow_wait",
      "payout_wait",
      "cancelled",
      "dispute_peer_wait",
      "dispute_resolution",
      "dispute_won",
      "dispute_lost",
      "wait"
    ].includes(view.panel)
  ) {
    return null;
  }

  if (view.requiredAction === "renew" && order.is_maker) {
    return (
      <Card className="trade-status-card trade-status-card-muted">
        <CardHeader><CardTitle>Offer expired</CardTitle></CardHeader>
        <CardContent>
          <p className="muted-copy">Review the previous terms, then publish the offer again.</p>
          <Button className="full-width" onClick={onRenew}>Renew offer</Button>
        </CardContent>
      </Card>
    );
  }

  if (view.panel === "chat") {
    return (
      <ChatStagePanel
        auth={chatAuth}
        baseUrl={coordinatorUrl}
        canSend
        myNick={myNick}
        myHashId={order.is_maker ? order.maker_hash_id : order.taker_hash_id}
        orderId={order.id}
        peerNick={order.is_maker ? order.taker_nick : order.maker_nick}
        peerHashId={order.is_maker ? order.taker_hash_id : order.maker_hash_id}
        robot={signingRobot}
        slotToken={slotToken}
        previewMode={previewMode}
      />
    );
  }

  if (view.panel === "success") {
    const queued = Boolean(order.tx_queued && !order.txid);
    const receipt = {
      order: order.id,
      coordinator: order.shortAlias,
      amount_sats: order.sent_satoshis || order.num_satoshis || order.trade_satoshis || order.invoice_amount,
      txid: order.txid,
      address: order.address,
      maker_summary: order.maker_summary,
      taker_summary: order.taker_summary,
      platform_summary: order.platform_summary
    };
    return (
      <Card className="trade-completion-card">
        <CardContent>
          <div className="trade-completion-hero">
            <h2><Zap size={22} aria-hidden /> {queued ? "Payout accepted" : "Trade finished!"} <Zap size={22} aria-hidden /></h2>
            <p>{queued ? "The payout is queued and will be broadcast shortly." : "Thank you for trading privately with RoboSats."}</p>
          </div>

          {queued ? <p className="trade-completion-note">This page will keep checking until the transaction is broadcast.</p> : null}
          {order.txid ? (
            <Button className="trade-completion-transaction" variant="secondary" onClick={() => window.open(blockExplorerUrl(order.txid!, order.network), "_blank", "noopener,noreferrer")}>
              <ExternalLink size={15} /> View transaction
            </Button>
          ) : null}
          {order.maker_summary || order.taker_summary || order.platform_summary ? (
            <details className="trade-completion-details">
              <summary>Receipt details</summary>
              <pre className="receipt-json">{JSON.stringify(receipt, null, 2)}</pre>
              <Button size="sm" variant="secondary" onClick={() => downloadJson(`robosats-order-${order.id}.json`, receipt)}>
                <Download size={14} /> Export receipt
              </Button>
            </details>
          ) : null}

          {!queued ? (
            <>
              <RatingSubmissionCard canSubmit={canSubmit} loading={loading} onSubmit={onSubmitAction} onPublishRating={onPublishRating} />
              <div className="trade-completion-restart">
                <p>RoboSats gets better with more liquidity. Tell a bitcoiner friend about it.</p>
                <Button variant="secondary" onClick={onStartAgain}><Rocket size={16} /> Start again</Button>
              </div>
              <CompletedTradeSummary order={order} />
            </>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (view.panel === "sending_sats") {
    return (
      <PayoutRoutingCard
        title="Attempting Lightning payment"
        body="RoboSats is paying your invoice. Keep the receiving wallet online."
        status={order.retries ? `Payment attempt ${Math.min(3, order.retries + 1)} of 3` : "Routing your payout"}
      />
    );
  }

  if (view.panel === "routing_failed" && !order.invoice_expired) {
    const retryAt = order.next_retry_time ? new Date(order.next_retry_time) : undefined;
    return (
      <PayoutRoutingCard
        title="Retrying Lightning payment"
        body="The previous route was unavailable. Keep the receiving wallet online."
        status={`Attempt ${Math.min(3, Math.max(1, order.retries || 1))} of 3 · ${retryAt && !Number.isNaN(retryAt.getTime()) ? `next try ${retryAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "retrying shortly"}`}
      />
    );
  }

  if (view.requiredAction === "pay_bond") {
    if (!coordinatorAcknowledged) {
      return (
        <Card className="trade-status-card trade-status-card-warning">
          <CardHeader><CardTitle>Trust the coordinator before bonding</CardTitle></CardHeader>
          <CardContent>
            <div className="trade-action"><ShieldAlert size={22} /><p>The coordinator holds the contract infrastructure and resolves disputes. Verify that you trust <strong>{order.shortAlias || "this coordinator"}</strong> before locking funds.</p></div>
            <Button className="full-width" onClick={() => { if (!previewMode) localStorage.setItem(trustKey, "true"); setCoordinatorAcknowledged(true); }}>I understand, continue</Button>
          </CardContent>
        </Card>
      );
    }
    return (
      <PaymentQrCard
        concept={order.is_taker ? "taker_bond" : "maker_bond"}
        title={order.is_taker ? "Taker bond invoice" : "Maker bond invoice"}
        value={order.bond_invoice}
        amountSats={order.bond_satoshis}
        expiresAt={order.expires_at}
        footer={footer}
        openWalletHref={`lightning:${order.bond_invoice}`}
        previewMode={previewMode}
      />
    );
  }

  if (view.requiredAction === "pay_escrow") {
    return (
      <PaymentQrCard
        concept="escrow"
        title="Seller collateral invoice"
        value={order.escrow_invoice}
        amountSats={order.escrow_satoshis}
        expiresAt={order.expires_at}
        footer={footer}
        openWalletHref={`lightning:${order.escrow_invoice}`}
        previewMode={previewMode}
      />
    );
  }

  if (view.requiredAction === "submit_payout" || view.requiredAction === "retry_invoice") {
    return (
      <PayoutSubmissionCard
        canSubmit={canSubmit}
        loading={loading}
        order={order}
        previewMode={previewMode}
        retryInvoice={view.requiredAction === "retry_invoice"}
        signingRobot={signingRobot}
        slotToken={slotToken}
        onSubmit={onSubmitPayout}
      />
    );
  }

  if (view.panel === "dispute_statement") {
    return (
      <DisputeStatementCard
        auth={chatAuth}
        baseUrl={coordinatorUrl}
        canSubmit={canSubmit}
        contactMethods={coordinatorContact}
        loading={loading}
        myNick={myNick}
        order={order}
        previewMode={previewMode}
        robot={signingRobot}
        slotToken={slotToken}
        onSubmit={onSubmitAction}
      />
    );
  }

  return (
    <TradeStatusCard
      tone="muted"
      icon={<Clock size={24} />}
      title="Waiting for next update"
      badge="waiting"
      body={view.message.body}
      details={[
        { label: "Order", value: `#${order.id || "preview"}` },
        { label: "Coordinator", value: order.shortAlias }
      ]}
    />
  );
}

function blockExplorerUrl(txid: string, network?: string): string {
  if (network === "testnet") return `https://mempool.space/testnet/tx/${txid}`;
  if (network === "signet") return `https://mempool.space/signet/tx/${txid}`;
  return `https://mempool.space/tx/${txid}`;
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function TradeStatusCard({
  badge,
  body,
  details,
  icon,
  title,
  tone
}: {
  badge: string;
  body: string;
  details: Array<{ label: string; value: string }>;
  icon: ReactNode;
  title: string;
  tone: "warning" | "danger" | "success" | "muted";
}) {
  return (
    <Card className={`trade-status-card trade-status-card-${tone}`}>
      <CardHeader className="payment-card-header">
        <CardTitle>{title}</CardTitle>
        <Badge tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : tone === "success" ? "success" : "muted"}>{badge}</Badge>
      </CardHeader>
      <CardContent>
        <div className="trade-status-card-body">
          <span className="trade-status-card-icon">{icon}</span>
          <p>{body}</p>
        </div>
        <dl className="summary-list trade-status-details">
          {details.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

type PayoutMode = "lightning" | "onchain";

function renewalDraft(order: OrderDto): CreateOrderDraft {
  const amount = order.amount ?? order.min_amount ?? 0;
  return {
    type: order.type === 1 ? 1 : 0,
    currency: order.currency,
    amount: String(amount),
    hasRange: Boolean(order.has_range),
    minAmount: String(order.min_amount ?? amount),
    maxAmount: String(order.max_amount ?? amount),
    paymentMethod: order.payment_method,
    isSwap: order.currency === 1000,
    isExplicit: false,
    premium: String(order.premium ?? 0),
    satoshis: "0",
    publicDuration: String(order.public_duration || 86_340),
    escrowDuration: String(order.escrow_duration || 10_800),
    bondSize: String(order.bond_size || 3),
    latitude: String(order.latitude || 0),
    longitude: String(order.longitude || 0),
    password: "",
    description: order.description ?? ""
  };
}

function PayoutSubmissionCard({
  canSubmit,
  loading,
  order,
  previewMode,
  retryInvoice,
  signingRobot,
  slotToken,
  onSubmit
}: {
  canSubmit: boolean;
  loading: boolean;
  order: OrderDto;
  previewMode: boolean;
  retryInvoice: boolean;
  signingRobot?: RobotRecord;
  slotToken?: string;
  onSubmit: (payload: SubmitOrderActionPayload) => Promise<void>;
}) {
  const [mode, setMode] = useState<PayoutMode>("lightning");
  const [invoice, setInvoice] = useState("");
  const [address, setAddress] = useState("");
  const [routingBudgetPpm, setRoutingBudgetPpm] = useState("2000");
  const [routingBudgetUnit, setRoutingBudgetUnit] = useState<"ppm" | "sats">("ppm");
  const [routingBudgetSatsInput, setRoutingBudgetSatsInput] = useState("");
  const [useLnProxy, setUseLnProxy] = useState(false);
  const [lnProxyInvoice, setLnProxyInvoice] = useState("");
  const [lnProxyBudgetSats, setLnProxyBudgetSats] = useState("0");
  const [lnProxyServerIndex, setLnProxyServerIndex] = useState(0);
  const [wrappingProxy, setWrappingProxy] = useState(false);
  const [miningFeeRate, setMiningFeeRate] = useState(String(Math.max(2, order.suggested_mining_fee_rate || 2)));
  const [signing, setSigning] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setMiningFeeRate(String(Math.max(2, order.suggested_mining_fee_rate || 2)));
  }, [order.suggested_mining_fee_rate]);

  async function submitPayout() {
    setLocalError("");
    if (!canSubmit) {
      setLocalError("Load this live order with your robot before submitting payout info.");
      return;
    }
    const payoutMode = retryInvoice ? "lightning" : mode;
    const rawValue = payoutMode === "lightning" ? normalizeLightningInvoice(invoice) : address.trim();
    if (!rawValue) {
      setLocalError(payoutMode === "lightning" ? "Paste a Lightning invoice first." : "Enter a Bitcoin address first.");
      return;
    }

    if (previewMode) {
      await onSubmit(payoutMode === "lightning"
        ? { action: "update_invoice", invoice: rawValue, routing_budget_ppm: effectiveRoutingPpm }
        : { action: "update_address", address: rawValue, mining_fee_rate: Number(miningFeeRate) || 2 });
      return;
    }

    const encPrivKey = signingRobot?.encPrivKey;
    if (!slotToken || !encPrivKey) {
      setLocalError("This robot is missing local encryption keys. Refresh it from Garage first.");
      return;
    }

    setSigning(true);
    let signedValue = "";
    try {
      signedValue = await signCleartextMessage(rawValue, encPrivKey, slotToken);
    } catch {
      setLocalError("Could not sign the payout method with this robot key.");
      setSigning(false);
      return;
    }

    try {
      if (payoutMode === "lightning") {
        await onSubmit({
          action: "update_invoice",
          invoice: signedValue,
          routing_budget_ppm: effectiveRoutingPpm
        });
      } else {
        await onSubmit({
          action: "update_address",
          address: signedValue,
          mining_fee_rate: Number(miningFeeRate) || 2
        });
      }
    } finally {
      setSigning(false);
    }
  }

  const payoutMode = retryInvoice ? "lightning" : mode;
  const error = localError || (payoutMode === "lightning" ? order.bad_invoice : order.bad_address) || "";
  const tradeAmount = order.trade_satoshis || order.invoice_amount;
  const routingPpm = routingBudgetUnit === "sats"
    ? Math.round(((Number(routingBudgetSatsInput) || 0) * 1_000_000) / Math.max(1, tradeAmount))
    : Number(routingBudgetPpm) || 0;
  const effectiveRoutingPpm = Math.min(100_001, Math.max(0, routingPpm));
  const lightningAmount = lightningPayoutAmount(tradeAmount, effectiveRoutingPpm);
  const routingBudgetSats = lightningRoutingBudgetSats(tradeAmount, effectiveRoutingPpm);
  const proxyServers = availableLnProxyServers();
  const parsedMiningFeeRate = Number(miningFeeRate);
  const onchainBreakdown = onchainPayoutBreakdown(order.invoice_amount, order.swap_fee_rate, parsedMiningFeeRate);
  const invalidMiningFee = !Number.isFinite(parsedMiningFeeRate) || parsedMiningFeeRate < 2 || parsedMiningFeeRate > 500;
  const currencyCode = currencyCodeFromId(order.currency) ?? String(order.currency);
  const amountBeingPaid = order.currency === 1000
    ? formatSats(orderReferenceSats(order))
    : formatFiat(order.amount, currencyCode);

  return (
    <Card className="payout-entry-card">
      <CardHeader className="payout-entry-header">
        <CardTitle>{retryInvoice ? "Payout failed" : "Choose your payout"}</CardTitle>
        <p>
          {retryInvoice
            ? "Submit a new Lightning invoice to retry your payout."
            : <>Before you send {amountBeingPaid}, make sure you can receive the bitcoin.</>}
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="payout-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitPayout();
          }}
        >
          {!retryInvoice ? (
            <div className="segmented payout-mode-tabs" role="group" aria-label="Payout method">
              <Button type="button" variant={mode === "lightning" ? "primary" : "secondary"} onClick={() => setMode("lightning")}>
                <Zap size={16} /> Lightning
              </Button>
              <Button
                type="button"
                variant={mode === "onchain" ? "primary" : "secondary"}
                disabled={!order.swap_allowed || order.currency === 1000}
                onClick={() => setMode("onchain")}
              >
                <Link2 size={16} /> On-chain
              </Button>
            </div>
          ) : null}

          {payoutMode === "lightning" ? (
            <>
              <div className="payout-invoice-target">
                <span>Invoice amount</span>
                <strong className="tabular amount-mono">{formatSats(lightningAmount)}</strong>
                <Button type="button" size="icon" variant="ghost" aria-label="Copy invoice amount" onClick={() => navigator.clipboard?.writeText(String(lightningAmount))}>
                  <Copy size={15} />
                </Button>
              </div>
              <label className="field-block">
                Lightning invoice
                <input
                  value={invoice}
                  onChange={(event) => setInvoice(event.target.value)}
                  placeholder="lnbc..."
                />
              </label>
              <details className="payout-advanced">
                <summary>Advanced</summary>
                <label className="field-block">
                  Routing budget
                  <div className="input-with-unit">
                    <input
                      inputMode="numeric"
                      min={0}
                      max={routingBudgetUnit === "ppm" ? 100001 : tradeAmount}
                      type="number"
                      value={routingBudgetUnit === "ppm" ? routingBudgetPpm : routingBudgetSatsInput}
                      onChange={(event) => routingBudgetUnit === "ppm" ? setRoutingBudgetPpm(event.target.value) : setRoutingBudgetSatsInput(event.target.value)}
                    />
                    <Button type="button" size="sm" variant="ghost" onClick={() => {
                      if (routingBudgetUnit === "ppm") setRoutingBudgetSatsInput(String(routingBudgetSats));
                      else setRoutingBudgetPpm(String(effectiveRoutingPpm));
                      setRoutingBudgetUnit((unit) => unit === "ppm" ? "sats" : "ppm");
                    }}>{routingBudgetUnit}</Button>
                  </div>
                  <small className="muted-copy">Routing allowance: {formatSats(routingBudgetSats)}</small>
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={useLnProxy} onChange={(event) => setUseLnProxy(event.target.checked)} />
                  <span><strong>Use LNProxy</strong><small>Hide your receiving wallet from the coordinator.</small></span>
                </label>
                {useLnProxy ? (
                  <div className="payout-form">
                    <label className="field-block">Destination invoice
                      <textarea rows={3} value={lnProxyInvoice} onChange={(event) => setLnProxyInvoice(event.target.value)} placeholder="Invoice for the net amount" />
                    </label>
                    <label className="field-block">LNProxy routing budget (sats)
                      <input type="number" min={0} value={lnProxyBudgetSats} onChange={(event) => setLnProxyBudgetSats(event.target.value)} />
                    </label>
                    <label className="field-block">LNProxy server
                      <select value={lnProxyServerIndex} onChange={(event) => setLnProxyServerIndex(Number(event.target.value))}>
                        {proxyServers.map((server, index) => <option key={server.url} value={index}>{server.name}</option>)}
                      </select>
                    </label>
                    <Button type="button" variant="secondary" loading={wrappingProxy} disabled={!lnProxyInvoice || proxyServers.length === 0} onClick={async () => {
                      const server = proxyServers[lnProxyServerIndex];
                      if (!server) return;
                      setWrappingProxy(true);
                      setLocalError("");
                      try {
                        if (previewMode) setInvoice(`lnbc${Math.max(1, lightningAmount)}n1fixtureprivateinvoice`);
                        else setInvoice(await wrapLnProxyInvoice(server, normalizeLightningInvoice(lnProxyInvoice), Number(lnProxyBudgetSats) || 0));
                      }
                      catch (proxyError) { setLocalError(toUserMessage(proxyError, "Could not wrap the invoice.")); }
                      finally { setWrappingProxy(false); }
                    }}>Create private invoice</Button>
                  </div>
                ) : null}
              </details>
            </>
          ) : (
            <>
              <p className="payout-onchain-copy">The coordinator swaps the payout and sends it to your Bitcoin address.</p>
              <dl className="payout-cost-summary">
                <div>
                  <dt>Swap fee</dt>
                  <dd>{formatSats(onchainBreakdown.swapFeeSats)} ({order.swap_fee_rate.toFixed(2)}%)</dd>
                </div>
                <div>
                  <dt>Mining fee</dt>
                  <dd>{formatSats(onchainBreakdown.miningFeeSats)} ({onchainBreakdown.effectiveMiningFeeRate} sats/vbyte)</dd>
                </div>
                <div className="payout-cost-total">
                  <dt>Final amount you receive</dt>
                  <dd>{formatSats(onchainBreakdown.finalSats)}</dd>
                </div>
              </dl>
              <div className="payout-onchain-fields">
                <label className="field-block">
                  Bitcoin address
                  <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="bc1..." />
                </label>
                <label className="field-block">
                  Mining fee
                  <div className="input-with-unit">
                    <input
                      inputMode="decimal"
                      min={2}
                      max={500}
                      type="number"
                      value={miningFeeRate}
                      onChange={(event) => setMiningFeeRate(event.target.value)}
                    />
                    <span className="input-unit-label">sat/vB</span>
                  </div>
                </label>
              </div>
            </>
          )}

          {error ? <p className="field-error">{error}</p> : null}

          <Button
            className="full-width"
            disabled={payoutMode === "lightning" ? normalizeLightningInvoice(invoice).length < 20 : invalidMiningFee || !address.trim()}
            loading={loading || signing}
            type="submit"
          >
            {payoutMode === "lightning" ? <Zap size={16} /> : <Link2 size={16} />}
            {retryInvoice ? "Submit new invoice" : "Submit"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function getSigningRobot(slot: RobotSlot | undefined, shortAlias: string): RobotRecord | undefined {
  if (!slot) return undefined;
  return slot.robots[shortAlias] ?? Object.values(slot.robots)[0];
}

function getCurrentRobotNick(order: OrderDto): string {
  if (order.is_maker) return order.maker_nick;
  if (order.is_taker) return order.taker_nick;
  return "";
}

function normalizeLightningInvoice(value: string): string {
  const invoice = value.trim();
  return invoice.toLowerCase().startsWith("lightning:") ? invoice.slice("lightning:".length) : invoice;
}

function TradeProgress({ order }: { order: OrderDto }) {
  const labels = order.is_taker ? ["Take", "Setup", "Trade", "Finish"] : ["Publish", "Wait", "Setup", "Trade", "Finish"];
  const activeIndex = tradeStepIndex(order);

  return (
    <div className={`trade-progress trade-progress-${labels.length}`} aria-label="Trade progress">
      {labels.map((label, i) => {
        const state = progressStateForIndex(i, activeIndex, order);
      return (
        <div key={label} className={`trade-progress-step ${state}`}>
          <span className="trade-progress-dot">
            {state === "complete" ? <Check size={14} /> : <span>{i + 1}</span>}
          </span>
          <span className="trade-progress-label">{label}</span>
        </div>
        );
      })}
    </div>
  );
}

function tradeStepIndex(order: OrderDto): number {
  if (!order.is_taker && [1, 2, 3].includes(order.status)) return 1;
  if ([6, 7, 8].includes(order.status)) return order.is_taker ? 1 : 2;
  if ([9, 10, 11, 12].includes(order.status)) return order.is_taker ? 2 : 3;
  if ([13, 14, 15, 16, 17, 18].includes(order.status)) return order.is_taker ? 3 : 4;
  return 0;
}

function progressStateForIndex(index: number, activeIndex: number, order: OrderDto): string {
  const disputeLost = (order.status === 17 && order.is_maker) || (order.status === 18 && order.is_taker);
  const payoutRetrying = order.status === 15 && order.is_buyer && !order.invoice_expired;
  const completed =
    order.status === 14 ||
    ([13, 15].includes(order.status) && order.is_seller) ||
    ([17, 18].includes(order.status) && !disputeLost);
  if ((order.status === 15 && order.is_buyer) || disputeLost) {
    if (index === activeIndex) return payoutRetrying ? "waiting" : "danger";
  }
  if (completed && index <= activeIndex) return "complete";
  if (index < activeIndex) return "complete";
  if (index === activeIndex) return "active";
  return "pending";
}

function DisputeStatementCard({
  auth,
  baseUrl,
  canSubmit,
  contactMethods,
  loading,
  myNick,
  order,
  previewMode,
  robot,
  slotToken,
  onSubmit
}: {
  auth?: Auth;
  baseUrl?: string;
  canSubmit: boolean;
  contactMethods?: CoordinatorContact;
  loading: boolean;
  myNick: string;
  order: OrderDto;
  previewMode: boolean;
  robot?: RobotRecord;
  slotToken?: string;
  onSubmit: (payload: SubmitOrderActionPayload) => Promise<void>;
}) {
  const [statement, setStatement] = useState("");
  const [contactMethod, setContactMethod] = useState("");
  const [contact, setContact] = useState("");
  const [attachLogs, setAttachLogs] = useState(false);
  const [preparingLogs, setPreparingLogs] = useState(false);
  const [localError, setLocalError] = useState("");
  const availableContactMethods = Object.entries(contactMethods ?? {})
    .filter(([key, value]) => Boolean(value) && !["pgp", "fingerprint", "website"].includes(key))
    .map(([key]) => key);

  async function submitStatement() {
    setLocalError("");
    if (!canSubmit) {
      setLocalError("Load this live order with your robot before submitting a statement.");
      return;
    }
    const cleanedStatement = statement.trim();
    if (cleanedStatement.length < 100) {
      setLocalError("The statement is too short. Include at least 100 characters with the relevant facts and evidence.");
      return;
    }
    if (!contactMethod) {
      setLocalError("Select a contact method for the dispute coordinator.");
      return;
    }
    if (!contact.trim()) {
      setLocalError("Enter the contact address or username where the dispute coordinator can reach you.");
      return;
    }

    let submittedStatement = `${contactMethod}: ${contact.trim()}\n\n${cleanedStatement}`;
    try {
      if (attachLogs) {
        setPreparingLogs(true);
        const messages = await loadDisputeMessages();
        submittedStatement = JSON.stringify({ statement: submittedStatement, messages }, null, 2);
      }
      if (submittedStatement.length > 50_000) {
        setLocalError("The statement and attached logs exceed 50,000 characters. Shorten the statement or submit without chat logs.");
        return;
      }
      await onSubmit({ action: "submit_statement", statement: submittedStatement });
    } catch (error) {
      setLocalError(toUserMessage(error, "Could not prepare the dispute statement."));
    } finally {
      setPreparingLogs(false);
    }
  }

  async function loadDisputeMessages() {
    if (previewMode) {
      return [
        { index: 1, plainTextMessage: "Fixture chat message from the trade peer.", validSignature: true, userNick: "Trade peer", time: new Date().toISOString() },
        { index: 2, plainTextMessage: "Fixture response from your robot.", validSignature: true, userNick: myNick || "Your robot", time: new Date().toISOString() }
      ];
    }
    if (!baseUrl || !auth || !robot?.encPrivKey || !robot.pubKey || !slotToken) {
      throw new Error("Chat logs cannot be attached because this robot's local encryption keys are unavailable.");
    }
    const response = await fetchChatMessages(baseUrl, order.id, 0, auth);
    const messages = await Promise.all(response.messages
      .filter((message) => message.encryptedMessage.startsWith("-----BEGIN PGP MESSAGE-----"))
      .map(async (message) => {
        let plainTextMessage = "Encrypted message could not be decrypted.";
        let validSignature = false;
        try {
          plainTextMessage = await decryptChatMessage({
            armoredMessage: message.encryptedMessage,
            ownPrivateKeyArmored: robot.encPrivKey ?? "",
            ownPublicKeyArmored: robot.pubKey ?? "",
            passphrase: slotToken,
            peerPublicKeyArmored: response.peerPubkey
          });
          validSignature = true;
        } catch {
          // Preserve the encrypted source even when a message cannot decrypt.
        }
        return {
          index: message.index,
          encryptedMessage: message.encryptedMessage,
          plainTextMessage,
          validSignature,
          userNick: message.nick || myNick,
          time: message.time
        };
      }));
    return messages;
  }

  const error = localError || order.bad_statement || "";

  return (
    <Card>
      <CardHeader className="payment-card-header">
        <CardTitle>Dispute statement</CardTitle>
        <Badge tone="danger">dispute</Badge>
      </CardHeader>
      <CardContent>
        <form
          className="payout-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitStatement();
          }}
        >
          <div className="trade-action">
            <FileText size={24} />
            <div>
              <strong>Explain what happened</strong>
              <p className="muted-copy">Build a complete case and provide a reachable burner contact. The coordinator cannot otherwise read your private trade chat.</p>
            </div>
          </div>
          <label className="field-block">
            Statement *
            <textarea
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              placeholder="I sent fiat at HH:MM using the agreed method. The seller has not confirmed..."
              rows={7}
            />
          </label>
          <div className="dispute-contact-grid">
            <label className="field-block">
              Contact method *
              <select required value={contactMethod} onChange={(event) => setContactMethod(event.target.value)}>
                <option value="" disabled>Select a contact method</option>
                {availableContactMethods.map((method) => <option key={method} value={method}>{contactMethodLabel(method)}</option>)}
                <option value="other">Other</option>
              </select>
            </label>
            <label className="field-block">
              Contact address or username *
              <input required value={contact} onChange={(event) => setContact(event.target.value)} placeholder={contactPlaceholder(contactMethod)} />
            </label>
          </div>
          <label className="toggle-row dispute-logs-toggle">
            <input type="checkbox" checked={attachLogs} onChange={(event) => setAttachLogs(event.target.checked)} />
            <Paperclip size={17} />
            <span><strong>Attach chat logs</strong><small>This helps the dispute solver, but may reveal private trade details.</small></span>
          </label>
          {error ? <p className="field-error">{error}</p> : null}
          <Button className="full-width" loading={loading || preparingLogs} type="submit">
            <FileText size={16} />
            Submit statement
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function contactMethodLabel(value: string): string {
  if (value === "simplex") return "SimpleX";
  if (value === "nostr") return "Nostr";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function contactPlaceholder(method: string): string {
  if (method === "email") return "burner@example.com";
  if (method === "telegram") return "@searchable_username";
  if (method === "simplex") return "SimpleX incognito contact link";
  if (method === "nostr") return "npub or NIP-05 address";
  return "How the coordinator can reach you";
}

function RatingSubmissionCard({
  canSubmit,
  loading,
  onSubmit,
  onPublishRating
}: {
  canSubmit: boolean;
  loading: boolean;
  onSubmit: (payload: SubmitOrderActionPayload) => Promise<void>;
  onPublishRating?: (rating: number) => Promise<void>;
}) {
  const [rating, setRating] = useState(0);
  const [localError, setLocalError] = useState("");

  async function submitRating() {
    setLocalError("");
    if (!canSubmit) {
      setLocalError("Load this live order with your robot before rating the trade.");
      return;
    }
    try {
      if (onPublishRating) await onPublishRating(rating);
      else await onSubmit({ action: "rate_platform", rating });
    } catch (error) {
      setLocalError(toUserMessage(error, "Could not publish the rating."));
    }
  }

  const ratingLabels = ["Poor", "Fair", "Good", "Very good", "Excellent"];

  return (
    <section className="trade-completion-rating">
      <div className="trade-completion-rating-heading">
        <h3>What do you think of RoboSats?</h3>
      </div>
      <form
        className="trade-completion-rating-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submitRating();
        }}
      >
        <div className="rating-options" role="radiogroup" aria-label="Trade rating">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              aria-checked={rating === value}
              aria-label={`${value} stars, ${ratingLabels[value - 1]}`}
              className={`rating-star-button ${rating >= value ? "rating-star-button-active" : ""}`}
              key={value}
              onClick={() => setRating(value)}
              role="radio"
              type="button"
            >
              <Star size={30} />
            </button>
          ))}
        </div>
        {rating ? <p className="trade-completion-rating-label">{ratingLabels[rating - 1]}</p> : null}
        {localError ? <p className="field-error">{localError}</p> : null}
        <Button className="full-width" disabled={!rating} loading={loading} type="submit">
          <Star size={16} />
          Submit rating
        </Button>
      </form>
    </section>
  );
}

function PayoutRoutingCard({
  body,
  status,
  title
}: {
  body: string;
  status: string;
  title: string;
}) {
  return (
    <Card className="payout-routing-card">
      <CardContent aria-live="polite">
        <h2>{title}</h2>
        <span className="payout-routing-spinner" aria-label={status} role="status" />
        <div className="payout-routing-copy">
          <p>{body}</p>
          <small>{status}</small>
        </div>
      </CardContent>
    </Card>
  );
}

type CompletionSummarySide = "maker" | "platform" | "taker";

function CompletedTradeSummary({ order }: { order: OrderDto }) {
  const [side, setSide] = useState<CompletionSummarySide>(order.is_maker ? "maker" : "taker");
  const currencyCode = currencyCodeFromId(order.currency);
  const fallbackSats = firstPositiveNumber(
    order.sent_satoshis,
    order.num_satoshis,
    order.trade_satoshis,
    order.satoshis,
    order.invoice_amount
  );
  const makerIsBuyer = order.is_maker ? order.is_buyer : !order.is_buyer;
  const selectedSummary = side === "maker" ? order.maker_summary : order.taker_summary;
  const selectedIsBuyer = recordBoolean(selectedSummary, "is_buyer", side === "maker" ? makerIsBuyer : !makerIsBuyer);
  const fiatAmount = recordNumber(selectedSummary, selectedIsBuyer ? "sent_fiat" : "received_fiat", order.amount ?? 0);
  const bitcoinAmount = recordNumber(selectedSummary, selectedIsBuyer ? "received_sats" : "sent_sats", fallbackSats);
  const tradeFeeSats = recordNumber(selectedSummary, "trade_fee_sats", 0);
  const tradeFeePercent = recordNumber(selectedSummary, "trade_fee_percent", order.trade_fee_percent ?? 0);

  return (
    <section className="completed-trade-summary">
      <h3>Trade summary</h3>
      <div className="completed-summary-tabs" role="tablist" aria-label="Trade summary participant">
        <button className={side === "maker" ? "active" : ""} onClick={() => setSide("maker")} role="tab" type="button">
          <RobotAvatar hashId={order.maker_hash_id} label={order.maker_nick || "Maker"} size="sm" />
          <span>Maker</span>
        </button>
        <button className={side === "platform" ? "active" : ""} onClick={() => setSide("platform")} role="tab" type="button" aria-label="RoboSats summary">
          <img alt="" src="/static/assets/vector/R-notext.svg" />
        </button>
        <button className={side === "taker" ? "active" : ""} onClick={() => setSide("taker")} role="tab" type="button">
          <span>Taker</span>
          <RobotAvatar hashId={order.taker_hash_id} label={order.taker_nick || "Taker"} size="sm" />
        </button>
      </div>

      {side === "platform" ? (
        <dl className="completed-summary-details">
          <div><dt>Coordinator</dt><dd>{order.shortAlias || "RoboSats"}</dd></div>
          <div><dt>Order</dt><dd>#{order.id}</dd></div>
          {recordNumber(order.platform_summary, "trade_revenue_sats", 0) > 0 ? (
            <div><dt>Trade revenue</dt><dd>{formatSats(recordNumber(order.platform_summary, "trade_revenue_sats", 0))}</dd></div>
          ) : null}
        </dl>
      ) : (
        <dl className="completed-summary-details">
          <div><dt>User role</dt><dd>{selectedIsBuyer ? "Buyer" : "Seller"}</dd></div>
          <div><dt>{selectedIsBuyer ? "Fiat sent" : "Fiat received"}</dt><dd>{formatFiat(fiatAmount, currencyCode)}</dd></div>
          <div><dt>{selectedIsBuyer ? "Bitcoin received" : "Bitcoin sent"}</dt><dd>{formatSats(bitcoinAmount)}</dd></div>
          <div>
            <dt>Trade fee</dt>
            <dd>{formatSats(tradeFeeSats)}{tradeFeePercent > 0 ? ` (${formatSummaryPercent(tradeFeePercent)})` : ""}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function recordNumber(record: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = Number(record?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function recordBoolean(record: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  return typeof record?.[key] === "boolean" ? record[key] : fallback;
}

function firstPositiveNumber(...values: Array<number | null | undefined>): number {
  return values.find((value) => typeof value === "number" && Number.isFinite(value) && value > 0) ?? 0;
}

function formatSummaryPercent(value: number): string {
  const percentage = value > 0 && value < 1 ? value * 100 : value;
  return `${Number(percentage.toPrecision(3))}%`;
}
