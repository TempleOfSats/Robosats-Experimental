import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Check,
  Clock,
  Copy,
  FileText,
  Link2,
  Paperclip,
  RefreshCw,
  ShieldAlert,
  AlertTriangle,
  Trophy,
  XCircle,
  Zap
} from "lucide-react";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import type { CoordinatorContact, CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { currencyCodeFromId } from "@/domains/orderbook/currencies";
import {
  getRobotAuthForCoordinator,
  selectCurrentSlot,
  selectStandardGarageSlots,
  type RobotRecord,
  type RobotSlot,
  useGarageStore
} from "@/domains/garage/garageStore";
import { ChatStagePanel, PreChatDisclosure } from "@/domains/chat/ChatStagePanel";
import { Dialog } from "@/components/ui/dialog";
import { shouldOfferPreChat } from "@/domains/chat/preChat";
import { signCleartextMessage } from "@/domains/crypto/pgp";
import {
  getTradeActionCommands,
  shouldLeaveTradeAfterAction,
  type TradeActionCommand
} from "@/domains/orders/orderActions";
import {
  disputeOutcomeForCurrentRobot,
  getTradeViewState
} from "@/domains/orders/orderStateMachine";
import {
  orderLoadIdentityMatches,
  orderForLocator,
  useOrderStore,
  type OrderLoadFailure,
  type OrderLoadIdentity
} from "@/domains/orders/orderStore";
import {
  discardColdOrderLoad,
  isColdOrderLoadActive,
  registerOrderLoadRecovery,
  type OrderLoadRecoveryPhase
} from "@/domains/orders/orderLoadRecovery";
import { tradePreviewOrder } from "@/domains/orders/tradePreviewFixtures";
import { orderReferenceSats } from "@/domains/orders/orderModel";
import type { OrderDto, SubmitOrderActionPayload } from "@/domains/orders/order.types";
import { buildProvisionalMakerOrder, buildRenewOrderPayload, createOrder } from "@/domains/maker/makerApi";
import { ingestCoordinatorOrder, recordCoordinatorSettlement } from "@/domains/orders/orderActivity";
import { tradeStatusLabel } from "@/domains/orders/orderStatus";
import type { Auth } from "@/domains/transport/apiClient";
import { tradeMotionClass } from "@/domains/motion/tradeMotion";
import { PaymentQrCard } from "@/domains/payments/PaymentQrCard";
import {
  lightningPayoutAmount,
  lightningRoutingBudgetSats,
  onchainPayoutBreakdown
} from "@/domains/payments/payoutAmounts";
import { availableLnProxyServers, wrapLnProxyInvoice } from "@/domains/payments/lnProxy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatFiat, formatSats } from "@/lib/format";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { writeClipboard } from "@/lib/clipboard";
import { requestReviewToken } from "@/domains/reviews/reviewApi";
import { publishCoordinatorRating } from "@/domains/coordinators/coordinatorRatings";
import { fetchChatMessages } from "@/domains/chat/chatApi";
import { decryptChatMessage } from "@/domains/chat/chatCrypto";
import { toUserMessage } from "@/lib/userError";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import { isNativeApp } from "@/domains/transport/androidBridge";
import { useTorConnection } from "@/domains/transport/torConnection";
import { registerVisibleTrade } from "@/domains/notifications/orderFeedbackVisibility";
import { AppTransitionDialog } from "@/domains/navigation/AppTransitionFeedback";
import { ColdOrderLoadState } from "@/domains/orders/OrderLoadState";
import {
  OrderDetailsPanel,
  OrderEyebrow,
  shouldOpenOrderDetailsByDefault
} from "@/domains/orders/OrderDetailsPanel";
import { TradeProgress } from "@/domains/orders/TradeProgress";
import { CompletedTradePanel } from "@/domains/orders/CompletedTradePanel";

const LazyRewardWithdrawalDialog = lazy(() =>
  import("@/domains/rewards/RewardWithdrawalDialog").then((module) => ({ default: module.RewardWithdrawalDialog }))
);
const TRADE_LAB_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_TRADE_LAB === "true";

export function OrderPage({
  embeddedLocator,
  onEmbeddedClose,
  onEmbeddedOrderChange
}: {
  embeddedLocator?: { shortAlias: string; orderId: number };
  onEmbeddedClose?: () => void;
  onEmbeddedOrderChange?: (locator: { shortAlias: string; orderId: number }) => void;
} = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const params = useParams();
  const shortAlias = embeddedLocator?.shortAlias ?? params.shortAlias ?? "local";
  const orderId = embeddedLocator?.orderId ?? Number(params.orderId ?? 0);
  const coordinators = useFederationStore((state) => state.coordinators);
  const slots = useGarageStore((state) => state.slots);
  const currentToken = useGarageStore((state) => state.currentToken);
  const proEnabled = useProPreferencesStore((state) => state.enabled);
  const hydrateGarage = useGarageStore((state) => state.hydrate);
  const releaseOrderReservation = useGarageStore((state) => state.releaseOrderReservation);
  const torConnection = useTorConnection();
  const {
    order: storedOrder,
    orderIdentity: storedOrderIdentity,
    submitting,
    loadFailure,
    actionError,
    loadOrder,
    submitAction,
    clearOrder
  } = useOrderStore();
  const eligibleSlots = proEnabled || embeddedLocator ? slots : selectStandardGarageSlots(slots);
  const routeSlotId = (location.state as { robotSlotId?: string } | null)?.robotSlotId;
  const routeSlot = routeSlotId ? eligibleSlots.find((slot) => slot.tokenSHA256 === routeSlotId) : undefined;
  const currentSlot = routeSlot ?? selectCurrentSlot(eligibleSlots, currentToken);
  const currentSlotId = currentSlot?.tokenSHA256;
  const coordinator =
    coordinators.find((item) => item.shortAlias === shortAlias) ??
    coordinators.find((item) => item.shortAlias === "local");
  const coordinatorRef = useRef(coordinator);
  const coordinatorRefreshKey = orderRefreshCoordinatorKey(coordinator);
  const currentSlotRef = useRef(currentSlot);
  const { identityKey: loadIdentityKey, loadedOrder } = orderPageLoadContext({
    coordinator,
    order: storedOrder,
    orderId,
    orderIdentity: storedOrderIdentity,
    shortAlias,
    slotId: currentSlotId
  });
  const loadedOrderRef = useRef(loadedOrder);
  const independentInitialLoadKeyRef = useRef<string | undefined>(undefined);
  const previousLoadIdentityKey = useRef<string | undefined>(undefined);
  const coordinatorAuth = coordinator ? getRobotAuthForCoordinator(currentSlot, coordinator.shortAlias) : undefined;
  const signingRobot = getSigningRobot(currentSlot, shortAlias);
  const previousStatus = useRef<number | undefined>(undefined);
  const previousWasTaker = useRef(false);
  const previewScenario = TRADE_LAB_ENABLED ? searchParams.get("tradePreview") : null;
  const previewOrder = TRADE_LAB_ENABLED ? tradePreviewOrder(previewScenario) : undefined;
  const visibleOrder = previewOrder ?? loadedOrder;
  const [previewNotice, setPreviewNotice] = useState("");
  const [loadRecoveryPhase, setLoadRecoveryPhase] = useState<OrderLoadRecoveryPhase>("loading");
  const loadRecovery = useRef<ReturnType<typeof registerOrderLoadRecovery> | undefined>(undefined);
  const visibleError = orderPageError(actionError, loadFailure);

  useLayoutEffect(() => {
    if (previewOrder || orderId < 1 || shortAlias === "local") return;
    return registerVisibleTrade(shortAlias, orderId, currentSlotId);
  }, [currentSlotId, orderId, previewOrder, shortAlias]);

  useEffect(() => {
    loadedOrderRef.current = loadedOrder;
    coordinatorRef.current = coordinator;
    currentSlotRef.current = currentSlot;
  }, [coordinator, currentSlot, loadedOrder]);

  useEffect(() => {
    hydrateGarage();
  }, [hydrateGarage]);

  useEffect(() => {
    if (previewOrder) return;
    const previousLoadIdentity = previousLoadIdentityKey.current;
    const loadIdentityChanged = previousLoadIdentity !== loadIdentityKey;
    previousLoadIdentityKey.current = loadIdentityKey;
    const locator = {
      slotId: currentSlotId,
      shortAlias,
      orderId
    };
    const discardedIncomingLoad = synchronizeOrderLoadIdentity({
      clearOrder,
      coordinatorEndpoint: coordinator?.url,
      identityChanged: loadIdentityChanged,
      loadedOrder,
      loadedOrderRef,
      locator
    });
    independentInitialLoadKeyRef.current =
      !loadedOrder && (discardedIncomingLoad || (previousLoadIdentity !== undefined && loadIdentityChanged))
        ? loadIdentityKey
        : undefined;
    previousStatus.current = undefined;
    previousWasTaker.current = false;
  }, [clearOrder, coordinatorRefreshKey, currentSlotId, loadIdentityKey, orderId, previewOrder, shortAlias]);

  useEffect(() => {
    if (previewOrder || !coordinator || !orderId) return;
    if (!loadedOrderRef.current) setLoadRecoveryPhase("loading");
    const recovery = registerOrderLoadRecovery({
      activeDelayMs: () => loadedOrderRefreshDelay(loadedOrderRef.current),
      coordinatorEndpoint: coordinator.url,
      locator: { slotId: currentSlotId, shortAlias, orderId },
      load: (reason) => {
        const independentRead = reason === "initial" && independentInitialLoadKeyRef.current === loadIdentityKey;
        if (independentRead) independentInitialLoadKeyRef.current = undefined;
        return loadOrder({
          coordinator: coordinatorRef.current ?? coordinator,
          independentRead,
          orderId,
          reason,
          slot: currentSlotRef.current
        });
      },
      onPhaseChange: setLoadRecoveryPhase,
      pauseWhileHidden: isNativeApp()
    });
    loadRecovery.current = recovery;
    return () => {
      recovery.dispose();
      loadRecovery.current = undefined;
    };
  }, [coordinatorRefreshKey, currentSlotId, loadOrder, orderId, previewOrder, shortAlias]);

  useEffect(() => {
    loadRecovery.current?.reschedule();
  }, [loadedOrder?.status, loadedOrder?.tx_queued]);

  useEffect(() => {
    if (!loadedOrder) return;
    const lastStatus = previousStatus.current;
    const wasTaker = previousWasTaker.current;
    previousStatus.current = loadedOrder.status;
    previousWasTaker.current = loadedOrder.is_taker;
    if (
      !previewOrder &&
      lastStatus !== undefined &&
      ![4, 12].includes(lastStatus) &&
      [4, 12].includes(loadedOrder.status)
    ) {
      if (!embeddedLocator) navigate("/offers", { replace: true });
      return;
    }
    if (!previewOrder && shouldReturnExpiredTakeToOffers(lastStatus, wasTaker, loadedOrder)) {
      if (currentSlot && orderId) {
        releaseOrderReservation(currentSlot.token, shortAlias, orderId);
      }
      if (onEmbeddedClose) onEmbeddedClose();
      else navigate("/offers", { replace: true });
      return;
    }
  }, [
    currentSlot,
    embeddedLocator,
    loadedOrder,
    navigate,
    onEmbeddedClose,
    orderId,
    previewOrder,
    releaseOrderReservation,
    shortAlias
  ]);

  useEffect(() => {
    if (
      previewOrder ||
      !embeddedLocator ||
      !onEmbeddedClose ||
      !loadedOrder ||
      loadedOrder.status !== 1 ||
      loadedOrder.is_maker ||
      loadedOrder.is_taker
    )
      return;
    onEmbeddedClose();
  }, [embeddedLocator, loadedOrder, onEmbeddedClose, previewOrder]);

  useEffect(() => {
    setPreviewNotice("");
  }, [previewOrder?.status, searchParams]);

  if (!visibleOrder) {
    return (
      <ColdOrderLoadState
        failure={loadFailure}
        orderId={orderId}
        phase={loadRecoveryPhase}
        reconnectingTor={torConnection.reconnectState === "reconnecting"}
        torReconnectAvailable={torConnection.canReconnect}
        torReconnectFailed={torConnection.reconnectState === "failed"}
        onReconnectTor={() => void torConnection.reconnect()}
        onRetry={() => loadRecovery.current?.retry()}
      />
    );
  }

  const order = visibleOrder;
  if (!previewOrder && order.status === 1 && !order.is_maker && !order.is_taker) {
    return embeddedLocator ? null : <Navigate replace to="/offers" />;
  }
  const view = getTradeViewState(order);
  const motionClass = tradeMotionClass(view);
  const actions = getTradeActionCommands(order, view);
  const currentRobotName = robotDisplayName(order, currentSlot);
  const currentRobotHashId =
    currentSlot?.hashId || (order.is_maker ? order.maker_hash_id : order.is_taker ? order.taker_hash_id : "");
  const isPayoutRoutingState = view.panel === "sending_sats" || view.panel === "routing_failed";
  const isQuietPaymentState =
    view.panel === "sending_sats" || view.panel === "routing_failed" || view.panel === "success";

  return (
    <main
      className={`page page-trade${embeddedLocator ? " page-trade-embedded" : ""}${isPayoutRoutingState ? " page-trade-routing" : ""}`}
    >
      {!isQuietPaymentState ? (
        <div className="page-heading">
          <div>
            <OrderEyebrow order={order} />
            <h2>{view.title}</h2>
          </div>
          {view.tone === "danger" ? (
            <Badge tone="danger">
              <XCircle size={12} />
              {tradeStatusLabel(order)}
            </Badge>
          ) : null}
        </div>
      ) : (
        <div className="trade-quiet-order-heading">
          <OrderEyebrow order={order} />
        </div>
      )}

      <TradeProgress order={order} />

      {visibleError ? (
        <div className="status-panel status-panel-warning order-error-panel">
          <AlertTriangle size={18} />
          <span>{visibleError}</span>
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
            coordinatorContact={
              previewOrder
                ? { email: "fixture", telegram: "fixture", simplex: "fixture", nostr: "fixture" }
                : coordinator?.contact
            }
            coordinatorName={coordinator?.longAlias || coordinator?.shortAlias || order.shortAlias || "Coordinator"}
            loading={submitting}
            myNick={currentRobotName}
            order={order}
            previewMode={Boolean(previewOrder)}
            preChatEnabled={shouldOfferPreChat(order.status, coordinator?.info)}
            previewTrustPrompt={previewScenario === "trust-coordinator"}
            signingRobot={previewOrder ? undefined : signingRobot}
            slotToken={previewOrder ? undefined : currentSlot?.token}
            view={view}
            rewardClaim={
              <DisputeRewardClaim
                coordinator={coordinator}
                order={order}
                previewMode={Boolean(previewOrder)}
                shortAlias={shortAlias}
                slot={currentSlot}
              />
            }
            onRenew={async (password) => {
              if (previewOrder) {
                setPreviewNotice("Renew offer simulated locally. No route change or request was made.");
                return;
              }
              if (!coordinator || !coordinatorAuth || !currentSlot) {
                throw new Error("Load the robot that created this offer before renewing it.");
              }

              const renewalPayload = buildRenewOrderPayload(order, password);
              const response = await createOrder(coordinator.url, renewalPayload, coordinatorAuth);
              const backendError =
                response.bad_request ?? response.bad_amount ?? response.bad_payment_method ?? response.bad_password;
              if (backendError) throw new Error(backendError);
              if (!response.id) throw new Error("Coordinator did not return a renewed order id.");

              ingestCoordinatorOrder({
                authoritative: false,
                order: buildProvisionalMakerOrder(response.id, shortAlias, renewalPayload, currentSlot),
                shortAlias,
                slot: currentSlot
              });
              if (onEmbeddedOrderChange) {
                onEmbeddedOrderChange({ shortAlias, orderId: response.id });
              } else {
                navigate(`/order/${shortAlias}/${response.id}`, { replace: true });
              }
            }}
            onStartAgain={() => {
              if (previewOrder) {
                setPreviewNotice("Start again simulated locally. No route change was made.");
                return;
              }
              onEmbeddedClose?.();
              navigate("/create");
            }}
            onPublishRating={
              previewOrder || !coordinator || !coordinatorAuth || !currentSlot
                ? undefined
                : async (rating) => {
                    const identity = deriveRobotIdentity(currentSlot.token);
                    const review = await requestReviewToken(coordinator.url, identity.nostrPubKey, coordinatorAuth);
                    if (!review.token) throw new Error("Coordinator did not issue a review token.");
                    await publishCoordinatorRating({
                      coordinator,
                      orderId: order.id,
                      rating,
                      reviewToken: review.token,
                      secretKey: identity.nostrSecKey
                    });
                  }
            }
            onSubmitAction={async (payload) => {
              if (previewOrder) {
                setPreviewNotice(`${previewActionLabel(payload.action)} simulated locally. No request was sent.`);
                return;
              }
              if (!coordinator || !currentSlot) return;
              await submitAction({ coordinator, orderId: order.id, slot: currentSlot, payload });
            }}
            onSubmitCommand={async (action) => {
              if (previewOrder) {
                setPreviewNotice(`${action.label} simulated locally. No request was sent.`);
                return;
              }
              if (!coordinator || !currentSlot || !action.payload) return;
              await submitAction({ coordinator, orderId: order.id, slot: currentSlot, payload: action.payload });
              const updated = useOrderStore.getState();
              if (!updated.actionError && shouldLeaveTradeAfterAction(action, updated.order)) {
                if (onEmbeddedClose) {
                  if (shouldDismissEmbeddedTrade(updated.order)) onEmbeddedClose();
                } else {
                  navigate("/offers", { replace: true });
                }
              }
            }}
            onSubmitPayout={async (payload, clearInvoice) => {
              if (previewOrder) {
                setPreviewNotice(`${previewActionLabel(payload.action)} simulated locally. No request was sent.`);
                return;
              }
              if (!coordinator || !currentSlot) return;
              await submitAction({ coordinator, orderId: order.id, slot: currentSlot, payload });
              const result = useOrderStore.getState();
              if (
                payload.action === "update_invoice" &&
                clearInvoice &&
                !result.actionError &&
                !result.order?.bad_invoice
              ) {
                recordCoordinatorSettlement({
                  slotId: currentSlot.tokenSHA256,
                  shortAlias: coordinator.shortAlias,
                  orderId: order.id,
                  purpose: "payout-received",
                  value: clearInvoice
                });
              }
            }}
          />
        </div>

        {!isQuietPaymentState ? (
          <div className="trade-panel-slot">
            <OrderDetailsPanel
              coordinator={coordinator}
              coordinatorAlias={shortAlias}
              defaultOpen={shouldOpenOrderDetailsByDefault(order)}
              order={order}
              robotHashId={currentRobotHashId}
              robotName={currentRobotName}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}

function loadedOrderRefreshDelay(order: OrderDto | undefined): number | undefined {
  return order ? jitterDelay(orderRefreshDelayMs(order.status, order.tx_queued), 0.1) : undefined;
}

function orderPageLoadContext({
  coordinator,
  order,
  orderId,
  orderIdentity,
  shortAlias,
  slotId
}: {
  coordinator: Pick<CoordinatorSummary, "url"> | undefined;
  order: OrderDto | undefined;
  orderId: number;
  orderIdentity: OrderLoadIdentity | undefined;
  shortAlias: string;
  slotId: string | undefined;
}): { identityKey: string; loadedOrder?: OrderDto } {
  const identityKey = JSON.stringify([coordinator?.url ?? null, slotId ?? null, shortAlias, orderId]);
  if (!coordinator) return { identityKey };
  const expectedIdentity = {
    coordinatorEndpoint: coordinator.url,
    slotId,
    shortAlias,
    orderId
  };
  if (!orderLoadIdentityMatches(orderIdentity, expectedIdentity)) return { identityKey };
  return { identityKey, loadedOrder: orderForLocator(order, shortAlias, orderId) };
}

function synchronizeOrderLoadIdentity({
  clearOrder,
  coordinatorEndpoint,
  identityChanged,
  loadedOrder,
  loadedOrderRef,
  locator
}: {
  clearOrder(): void;
  coordinatorEndpoint: string | undefined;
  identityChanged: boolean;
  loadedOrder: OrderDto | undefined;
  loadedOrderRef: { current: OrderDto | undefined };
  locator: { slotId?: string; shortAlias: string; orderId: number };
}): boolean {
  if (identityChanged && !loadedOrder) {
    const discardedIncomingLoad = discardColdOrderLoad(coordinatorEndpoint, locator);
    loadedOrderRef.current = undefined;
    clearOrder();
    return discardedIncomingLoad;
  }
  if (!loadedOrder && !isColdOrderLoadActive(coordinatorEndpoint, locator)) clearOrder();
  return false;
}

function orderRefreshCoordinatorKey(coordinator: Pick<CoordinatorSummary, "shortAlias" | "url"> | undefined): string {
  return coordinator ? `${coordinator.shortAlias}:${coordinator.url}` : "";
}

function orderPageError(
  actionError: string | undefined,
  loadFailure: OrderLoadFailure | undefined
): string | undefined {
  return actionError ?? loadFailure?.message;
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

export function jitterDelay(baseMs: number, ratio: number, random = Math.random): number {
  return Math.round(baseMs * (1 - ratio + random() * ratio * 2));
}

export function shouldReturnExpiredTakeToOffers(
  lastStatus: number | undefined,
  wasTaker: boolean,
  order: Pick<OrderDto, "status" | "is_maker">
): boolean {
  return lastStatus === 3 && wasTaker && order.status === 1 && !order.is_maker;
}

export function shouldDismissEmbeddedTrade(order?: Pick<OrderDto, "status" | "is_maker" | "is_taker">): boolean {
  return Boolean(order?.status === 1 && !order.is_maker && !order.is_taker);
}

function previewActionLabel(action?: string): string {
  if (!action) return "Action";
  return action.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function DisputeRewardClaim({
  coordinator,
  order,
  previewMode,
  shortAlias,
  slot
}: {
  coordinator?: CoordinatorSummary;
  order: OrderDto;
  previewMode: boolean;
  shortAlias: string;
  slot?: RobotSlot;
}) {
  const [open, setOpen] = useState(false);
  const rewardSats = slot?.robots[shortAlias]?.earnedRewards ?? 0;
  const canClaim =
    !previewMode &&
    disputeOutcomeForCurrentRobot(order) === "won" &&
    rewardSats > 0 &&
    Boolean(slot) &&
    coordinator?.shortAlias === shortAlias;

  useEffect(() => {
    if (previewMode) setOpen(false);
  }, [previewMode]);

  if (!canClaim && !open) return null;

  return (
    <>
      {canClaim ? (
        <Button className="trade-reward-action" onClick={() => setOpen(true)} type="button" variant="secondary">
          <Trophy size={16} />
          View {formatSats(rewardSats)} in robot rewards
        </Button>
      ) : null}
      {!previewMode && open && slot && coordinator?.shortAlias === shortAlias ? (
        <Suspense fallback={<AppTransitionDialog title="Preparing rewards" message="Loading the claim controls..." />}>
          <LazyRewardWithdrawalDialog coordinators={[coordinator]} onClose={() => setOpen(false)} slot={slot} />
        </Suspense>
      ) : null}
    </>
  );
}

function ContractPanel({
  actions,
  canSubmit,
  chatAuth,
  coordinatorUrl,
  coordinatorContact,
  coordinatorName,
  loading,
  myNick,
  order,
  preChatEnabled,
  previewMode,
  previewTrustPrompt,
  signingRobot,
  slotToken,
  view,
  rewardClaim,
  onPublishRating,
  onRenew,
  onStartAgain,
  onSubmitAction,
  onSubmitCommand,
  onSubmitPayout
}: {
  actions: TradeActionCommand[];
  canSubmit: boolean;
  chatAuth?: Auth;
  coordinatorUrl?: string;
  coordinatorContact?: CoordinatorContact;
  coordinatorName: string;
  loading: boolean;
  myNick: string;
  order: OrderDto;
  preChatEnabled: boolean;
  previewMode: boolean;
  previewTrustPrompt: boolean;
  signingRobot?: RobotRecord;
  slotToken?: string;
  view: ReturnType<typeof getTradeViewState>;
  rewardClaim: ReactNode;
  onPublishRating?: (rating: number) => Promise<void>;
  onRenew: (password?: string) => Promise<void>;
  onStartAgain: () => void;
  onSubmitAction: (payload: SubmitOrderActionPayload) => Promise<void>;
  onSubmitCommand: (action: TradeActionCommand) => Promise<void>;
  onSubmitPayout: (payload: SubmitOrderActionPayload, clearInvoice?: string) => Promise<void>;
}) {
  const isInvoicePaymentStep = view.requiredAction === "pay_bond" || view.requiredAction === "pay_escrow";
  const isChatStep = view.panel === "chat";
  const isDisputeStep = view.panel === "dispute_statement";
  const isPayoutStep = view.requiredAction === "submit_payout" || view.requiredAction === "retry_invoice";
  const isRenewalStep = view.requiredAction === "renew";
  const isSuccessStep = view.panel === "success";
  const isRoutingStep = view.panel === "sending_sats" || view.panel === "routing_failed";
  const isPublicMakerWait = view.panel === "public_order" && order.is_maker;

  return (
    <div className="trade-contract-stack">
      {isPublicMakerWait ? (
        <>
          <div className="trade-public-wait-notice" role="status">
            <Clock size={18} aria-hidden="true" />
            <span>
              <strong>Waiting for a taker</strong>
              <small>Be patient while robots check the book.</small>
            </span>
          </div>
          <TradeActionSurface actions={actions} canSubmit={canSubmit} loading={loading} onSubmit={onSubmitCommand} />
        </>
      ) : !isInvoicePaymentStep &&
        !isChatStep &&
        !isDisputeStep &&
        !isPayoutStep &&
        !isRenewalStep &&
        !isSuccessStep &&
        !isRoutingStep ? (
        <Card className="trade-contract-card">
          <CardHeader className="trade-contract-title-row">
            <CardTitle>{view.message.heading}</CardTitle>
          </CardHeader>
          <CardContent>
            {order.pending_cancel ? (
              <div className="status-panel status-panel-warning trade-cancel-notice">
                <AlertTriangle size={18} />
                <span>
                  Your peer requested collaborative cancellation. To accept, open Trade options and press Accept
                  cancellation.
                </span>
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
            {rewardClaim}
            <TradeActionSurface actions={actions} canSubmit={canSubmit} loading={loading} onSubmit={onSubmitCommand} />
          </CardContent>
        </Card>
      ) : null}

      {preChatEnabled ? (
        <PreChatDisclosure
          auth={chatAuth}
          baseUrl={coordinatorUrl}
          canSend={canSubmit}
          myNick={myNick}
          ownCoordinatorNick={getCurrentRobotNick(order)}
          myHashId={order.is_maker ? order.maker_hash_id : order.taker_hash_id}
          orderId={order.id}
          peerNick={order.is_maker ? order.taker_nick : order.maker_nick}
          peerHashId={order.is_maker ? order.taker_hash_id : order.maker_hash_id}
          previewMode={previewMode}
          robot={signingRobot}
          shortAlias={order.shortAlias}
          slotToken={slotToken}
        />
      ) : null}
      <TradePaymentPanel
        canSubmit={canSubmit}
        chatAuth={chatAuth}
        coordinatorUrl={coordinatorUrl}
        coordinatorContact={coordinatorContact}
        coordinatorName={coordinatorName}
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
        footer={
          isInvoicePaymentStep && actions.length > 0 ? (
            <TradeActionSurface actions={actions} canSubmit={canSubmit} loading={loading} onSubmit={onSubmitCommand} />
          ) : undefined
        }
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
  onSubmit: (action: TradeActionCommand) => Promise<void>;
}) {
  const primaryActions = actions.filter((action) => action.placement === "primary");
  const optionActions = actions.filter((action) => action.placement === "options");

  return (
    <div className="chat-trade-actions">
      {order.pending_cancel ? (
        <div className="status-panel status-panel-warning trade-cancel-notice">
          <AlertTriangle size={18} />
          <span>
            Your peer requested collaborative cancellation. To accept, open Trade options and press Accept cancellation.
          </span>
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

function TradeActionSurface({
  actions,
  canSubmit,
  loading,
  onSubmit
}: {
  actions: TradeActionCommand[];
  canSubmit: boolean;
  loading: boolean;
  onSubmit: (action: TradeActionCommand) => Promise<void>;
}) {
  const [pendingAction, setPendingAction] = useState<TradeActionCommand | null>(null);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const orderedActions = [...actions].sort((left, right) => left.displayOrder - right.displayOrder);

  if (actions.length === 0) {
    return null;
  }

  const submitCommand = async (action: TradeActionCommand) => {
    setActiveActionKey(action.key);
    try {
      await onSubmit(action);
    } finally {
      setActiveActionKey(null);
    }
  };

  const handleActionClick = (action: TradeActionCommand) => {
    if (action.requiresConfirmation && action.payload) {
      setPendingAction(action);
    } else {
      void submitCommand(action);
    }
  };

  const handleConfirm = () => {
    if (pendingAction) {
      void submitCommand(pendingAction);
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
          const disabledReason =
            action.disabledReason ?? (!canSubmit ? "Load a live order with an active robot first" : undefined);
          const isCritical = action.requiresConfirmation;
          const isActive = activeActionKey === action.key;
          return (
            <div className={`trade-action-command trade-action-command-${action.key}`} key={action.key}>
              <Button
                className="full-width"
                variant={action.variant}
                loading={isActive}
                disabled={Boolean(disabledReason) || !action.payload || (loading && !isActive)}
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
        <Dialog
          ariaLabel="Confirm action"
          onClose={handleCancel}
          overlayClassName="confirm-overlay"
          panelClassName="confirm-sheet"
        >
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
        </Dialog>
      )}
    </>
  );
}

function TradePaymentPanel({
  canSubmit,
  chatAuth,
  coordinatorUrl,
  coordinatorContact,
  coordinatorName,
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
  coordinatorName: string;
  loading: boolean;
  myNick: string;
  order: OrderDto;
  previewMode: boolean;
  previewTrustPrompt: boolean;
  footer?: ReactNode;
  signingRobot?: RobotRecord;
  slotToken?: string;
  onRenew: (password?: string) => Promise<void>;
  onStartAgain: () => void;
  onPublishRating?: (rating: number) => Promise<void>;
  onSubmitAction: (payload: SubmitOrderActionPayload) => Promise<void>;
  onSubmitPayout: (payload: SubmitOrderActionPayload, clearInvoice?: string) => Promise<void>;
}) {
  const view = getTradeViewState(order);
  const trustKey = `robosats_trusted_coordinator_${order.shortAlias || "unknown"}`;
  const [coordinatorAcknowledged, setCoordinatorAcknowledged] = useState(() =>
    previewTrustPrompt ? false : !coordinatorUrl || localStorage.getItem(trustKey) === "true"
  );

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
    return <ExpiredOrderRenewalCard order={order} onRenew={onRenew} />;
  }

  if (view.panel === "chat") {
    return (
      <ChatStagePanel
        key={`${order.id}:${order.is_maker ? order.maker_hash_id : order.taker_hash_id}`}
        auth={chatAuth}
        baseUrl={coordinatorUrl}
        canSend
        myNick={myNick}
        ownCoordinatorNick={getCurrentRobotNick(order)}
        myHashId={order.is_maker ? order.maker_hash_id : order.taker_hash_id}
        orderId={order.id}
        peerNick={order.is_maker ? order.taker_nick : order.maker_nick}
        peerHashId={order.is_maker ? order.taker_hash_id : order.maker_hash_id}
        robot={signingRobot}
        shortAlias={order.shortAlias}
        slotToken={slotToken}
        previewMode={previewMode}
      />
    );
  }

  if (view.panel === "success") {
    return (
      <CompletedTradePanel
        canSubmit={canSubmit}
        coordinatorName={coordinatorName}
        loading={loading}
        onPublishRating={onPublishRating}
        onStartAgain={onStartAgain}
        order={order}
      />
    );
  }

  if (view.panel === "sending_sats") {
    return (
      <PayoutRoutingCard
        title="Sending your payout"
        body="Keep your receiving wallet online."
        status={order.retries ? `Payment attempt ${Math.min(3, order.retries + 1)} of 3` : "Routing your payout"}
      />
    );
  }

  if (view.panel === "routing_failed" && !order.invoice_expired) {
    const retryAt = order.next_retry_time ? new Date(order.next_retry_time) : undefined;
    return (
      <PayoutRoutingCard
        retrying
        title="Retrying your payout"
        body="The previous route was unavailable. Keep the receiving wallet online."
        status={`Attempt ${Math.min(3, Math.max(1, order.retries || 1))} of 3 · ${retryAt && !Number.isNaN(retryAt.getTime()) ? `next try ${retryAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "retrying shortly"}`}
      />
    );
  }

  if (view.requiredAction === "pay_bond") {
    if (!coordinatorAcknowledged) {
      return (
        <Card className="trade-status-card trade-status-card-warning">
          <CardHeader>
            <CardTitle>Trust the coordinator before bonding</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="trade-action">
              <ShieldAlert size={22} />
              <p>
                The coordinator holds the contract infrastructure and resolves disputes. Verify that you trust{" "}
                <strong>{order.shortAlias || "this coordinator"}</strong> before locking funds.
              </p>
            </div>
            <Button
              className="full-width"
              onClick={() => {
                if (!previewMode) localStorage.setItem(trustKey, "true");
                setCoordinatorAcknowledged(true);
              }}
            >
              I understand, continue
            </Button>
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
        <Badge
          tone={
            tone === "danger" ? "danger" : tone === "warning" ? "warning" : tone === "success" ? "success" : "muted"
          }
        >
          {badge}
        </Badge>
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

function ExpiredOrderRenewalCard({
  order,
  onRenew
}: {
  order: OrderDto;
  onRenew: (password?: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState("");
  const passwordRequired = Boolean(order.has_password);
  const passwordErrorId = `renew-order-${order.id}-error`;

  async function renew() {
    if (passwordRequired && !password.trim()) {
      setRenewError("Enter the same password used for the original offer.");
      return;
    }

    setRenewing(true);
    setRenewError("");
    try {
      await onRenew(passwordRequired ? password : undefined);
    } catch (error) {
      setRenewError(toUserMessage(error, "Could not renew the offer."));
    } finally {
      setRenewing(false);
    }
  }

  return (
    <Card className="trade-status-card trade-status-card-muted">
      <CardHeader>
        <CardTitle>Offer expired</CardTitle>
      </CardHeader>
      <CardContent className="trade-renewal-content">
        <div className="trade-action">
          <Clock size={22} />
          <p>{order.expiry_message || "The public offer expired before another robot took it."}</p>
        </div>
        {passwordRequired ? (
          <label className="field-block">
            <span>Order password</span>
            <input
              aria-describedby={renewError ? passwordErrorId : undefined}
              aria-invalid={Boolean(renewError)}
              autoComplete="off"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setRenewError("");
              }}
            />
          </label>
        ) : null}
        {renewError ? (
          <div className="status-panel status-panel-danger" id={passwordErrorId} role="alert">
            <AlertTriangle size={18} />
            <span>{renewError}</span>
          </div>
        ) : null}
        <Button className="full-width" loading={renewing} onClick={() => void renew()}>
          <RefreshCw size={16} />
          Renew offer
        </Button>
      </CardContent>
    </Card>
  );
}

type PayoutMode = "lightning" | "onchain";

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
  onSubmit: (payload: SubmitOrderActionPayload, clearInvoice?: string) => Promise<void>;
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
      await onSubmit(
        payoutMode === "lightning"
          ? { action: "update_invoice", invoice: rawValue, routing_budget_ppm: effectiveRoutingPpm }
          : { action: "update_address", address: rawValue, mining_fee_rate: Number(miningFeeRate) || 2 },
        payoutMode === "lightning" ? rawValue : undefined
      );
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
        await onSubmit(
          {
            action: "update_invoice",
            invoice: signedValue,
            routing_budget_ppm: effectiveRoutingPpm
          },
          rawValue
        );
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
  const routingPpm =
    routingBudgetUnit === "sats"
      ? Math.round(((Number(routingBudgetSatsInput) || 0) * 1_000_000) / Math.max(1, tradeAmount))
      : Number(routingBudgetPpm) || 0;
  const effectiveRoutingPpm = Math.min(100_001, Math.max(0, routingPpm));
  const lightningAmount = lightningPayoutAmount(tradeAmount, effectiveRoutingPpm);
  const routingBudgetSats = lightningRoutingBudgetSats(tradeAmount, effectiveRoutingPpm);
  const proxyServers = availableLnProxyServers();
  const parsedMiningFeeRate = Number(miningFeeRate);
  const onchainBreakdown = onchainPayoutBreakdown(order.invoice_amount, order.swap_fee_rate, parsedMiningFeeRate);
  const invalidMiningFee =
    !Number.isFinite(parsedMiningFeeRate) || parsedMiningFeeRate < 2 || parsedMiningFeeRate > 500;
  const currencyCode = currencyCodeFromId(order.currency) ?? String(order.currency);
  const amountBeingPaid =
    order.currency === 1000 ? formatSats(orderReferenceSats(order)) : formatFiat(order.amount, currencyCode);

  return (
    <Card className="payout-entry-card">
      <CardHeader className="payout-entry-header">
        <CardTitle>{retryInvoice ? "Payout failed" : "Choose your payout"}</CardTitle>
        <p>
          {retryInvoice ? (
            "Submit a new Lightning invoice to retry your payout."
          ) : (
            <>Before you send {amountBeingPaid}, make sure you can receive the bitcoin.</>
          )}
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
              <Button
                type="button"
                variant={mode === "lightning" ? "primary" : "secondary"}
                onClick={() => setMode("lightning")}
              >
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
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Copy invoice amount"
                  onClick={() => void writeClipboard(String(lightningAmount)).catch(() => undefined)}
                >
                  <Copy size={15} />
                </Button>
              </div>
              <label className="field-block">
                Lightning invoice
                <input
                  aria-describedby={error ? "payout-error" : undefined}
                  aria-invalid={Boolean(error)}
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
                      onChange={(event) =>
                        routingBudgetUnit === "ppm"
                          ? setRoutingBudgetPpm(event.target.value)
                          : setRoutingBudgetSatsInput(event.target.value)
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (routingBudgetUnit === "ppm") setRoutingBudgetSatsInput(String(routingBudgetSats));
                        else setRoutingBudgetPpm(String(effectiveRoutingPpm));
                        setRoutingBudgetUnit((unit) => (unit === "ppm" ? "sats" : "ppm"));
                      }}
                    >
                      {routingBudgetUnit}
                    </Button>
                  </div>
                  <small className="muted-copy">Routing allowance: {formatSats(routingBudgetSats)}</small>
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={useLnProxy}
                    onChange={(event) => setUseLnProxy(event.target.checked)}
                  />
                  <span>
                    <strong>Use LNProxy</strong>
                    <small>Hide your receiving wallet from the coordinator.</small>
                  </span>
                </label>
                {useLnProxy ? (
                  <div className="payout-form">
                    <label className="field-block">
                      Destination invoice
                      <textarea
                        rows={3}
                        value={lnProxyInvoice}
                        onChange={(event) => setLnProxyInvoice(event.target.value)}
                        placeholder="Invoice for the net amount"
                      />
                    </label>
                    <label className="field-block">
                      LNProxy routing budget (sats)
                      <input
                        type="number"
                        min={0}
                        value={lnProxyBudgetSats}
                        onChange={(event) => setLnProxyBudgetSats(event.target.value)}
                      />
                    </label>
                    <label className="field-block">
                      LNProxy server
                      <select
                        value={lnProxyServerIndex}
                        onChange={(event) => setLnProxyServerIndex(Number(event.target.value))}
                      >
                        {proxyServers.map((server, index) => (
                          <option key={server.url} value={index}>
                            {server.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      type="button"
                      variant="secondary"
                      loading={wrappingProxy}
                      disabled={!lnProxyInvoice || proxyServers.length === 0}
                      onClick={async () => {
                        const server = proxyServers[lnProxyServerIndex];
                        if (!server) return;
                        setWrappingProxy(true);
                        setLocalError("");
                        try {
                          if (previewMode) setInvoice(`lnbc${Math.max(1, lightningAmount)}n1fixtureprivateinvoice`);
                          else
                            setInvoice(
                              await wrapLnProxyInvoice(
                                server,
                                normalizeLightningInvoice(lnProxyInvoice),
                                Number(lnProxyBudgetSats) || 0
                              )
                            );
                        } catch (proxyError) {
                          setLocalError(toUserMessage(proxyError, "Could not wrap the invoice."));
                        } finally {
                          setWrappingProxy(false);
                        }
                      }}
                    >
                      Create private invoice
                    </Button>
                  </div>
                ) : null}
              </details>
            </>
          ) : (
            <>
              <p className="payout-onchain-copy">
                The coordinator swaps the payout and sends it to your Bitcoin address.
              </p>
              <dl className="payout-cost-summary">
                <div>
                  <dt>Swap fee</dt>
                  <dd>
                    {formatSats(onchainBreakdown.swapFeeSats)} ({order.swap_fee_rate.toFixed(2)}%)
                  </dd>
                </div>
                <div>
                  <dt>Mining fee</dt>
                  <dd>
                    {formatSats(onchainBreakdown.miningFeeSats)} ({onchainBreakdown.effectiveMiningFeeRate} sats/vbyte)
                  </dd>
                </div>
                <div className="payout-cost-total">
                  <dt>Final amount you receive</dt>
                  <dd>{formatSats(onchainBreakdown.finalSats)}</dd>
                </div>
              </dl>
              <div className="payout-onchain-fields">
                <label className="field-block">
                  Bitcoin address
                  <input
                    aria-describedby={error ? "payout-error" : undefined}
                    aria-invalid={Boolean(error)}
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="bc1..."
                  />
                </label>
                <label className="field-block">
                  Mining fee
                  <div className="input-with-unit">
                    <input
                      inputMode="decimal"
                      min={2}
                      max={500}
                      step="any"
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

          {error ? (
            <p className="field-error" id="payout-error" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            className="full-width"
            disabled={
              payoutMode === "lightning"
                ? normalizeLightningInvoice(invoice).length < 20
                : invalidMiningFee || !address.trim()
            }
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

function robotDisplayName(order: OrderDto, slot: RobotSlot | undefined): string {
  if (slot?.nickname?.trim()) return slot.nickname.trim();
  const orderNick = getCurrentRobotNick(order).trim();
  if (orderNick && !/^(?:none|null|undefined)$/i.test(orderNick)) return orderNick;
  return "Your robot";
}

function normalizeLightningInvoice(value: string): string {
  const invoice = value.trim();
  return invoice.toLowerCase().startsWith("lightning:") ? invoice.slice("lightning:".length) : invoice;
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
      setLocalError(
        "The statement is too short. Include at least 100 characters with the relevant facts and evidence."
      );
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
        setLocalError(
          "The statement and attached logs exceed 50,000 characters. Shorten the statement or submit without chat logs."
        );
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
        {
          index: 1,
          plainTextMessage: "Fixture chat message from the trade peer.",
          validSignature: true,
          userNick: "Trade peer",
          time: new Date().toISOString()
        },
        {
          index: 2,
          plainTextMessage: "Fixture response from your robot.",
          validSignature: true,
          userNick: myNick || "Your robot",
          time: new Date().toISOString()
        }
      ];
    }
    if (!baseUrl || !auth || !robot?.encPrivKey || !robot.pubKey || !slotToken) {
      throw new Error("Chat logs cannot be attached because this robot's local encryption keys are unavailable.");
    }
    const response = await fetchChatMessages(baseUrl, order.id, 0, auth);
    const messages = await Promise.all(
      response.messages
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
        })
    );
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
              <p className="muted-copy">
                Build a complete case and provide a reachable burner contact. The coordinator cannot otherwise read your
                private trade chat.
              </p>
            </div>
          </div>
          <label className="field-block">
            Statement *
            <textarea
              aria-describedby={error ? "dispute-statement-error" : undefined}
              aria-invalid={Boolean(error)}
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              placeholder="I sent fiat at HH:MM using the agreed method. The seller has not confirmed..."
              rows={7}
            />
          </label>
          <div className="dispute-contact-grid">
            <label className="field-block">
              Contact method *
              <select
                aria-describedby={error ? "dispute-statement-error" : undefined}
                aria-invalid={Boolean(error)}
                required
                value={contactMethod}
                onChange={(event) => setContactMethod(event.target.value)}
              >
                <option value="" disabled>
                  Select a contact method
                </option>
                {availableContactMethods.map((method) => (
                  <option key={method} value={method}>
                    {contactMethodLabel(method)}
                  </option>
                ))}
                <option value="other">Other</option>
              </select>
            </label>
            <label className="field-block">
              Contact address or username *
              <input
                aria-describedby={error ? "dispute-statement-error" : undefined}
                aria-invalid={Boolean(error)}
                required
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                placeholder={contactPlaceholder(contactMethod)}
              />
            </label>
          </div>
          <label className="toggle-row dispute-logs-toggle">
            <input type="checkbox" checked={attachLogs} onChange={(event) => setAttachLogs(event.target.checked)} />
            <Paperclip size={17} />
            <span>
              <strong>Attach chat logs</strong>
              <small>This helps the dispute solver, but may reveal private trade details.</small>
            </span>
          </label>
          {error ? (
            <p className="field-error" id="dispute-statement-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            className="full-width dispute-submit-button"
            loading={loading || preparingLogs}
            type="submit"
            variant="outline"
          >
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

const payoutBoltLanes = [
  { delay: "t1", lane: "lane-1" },
  { delay: "t2", lane: "lane-2" },
  { delay: "t3", lane: "lane-3" },
  { delay: "t4", lane: "lane-4" },
  { delay: "t5", lane: "lane-5" }
];

function PayoutRoutingCard({
  body,
  retrying = false,
  status,
  title
}: {
  body: string;
  retrying?: boolean;
  status: string;
  title: string;
}) {
  const boltPath = "M80 52h8l-3.4 6.6h6.2l-9.1 13 3.1-8h-6.5Z";
  return (
    <Card className={`payout-routing-card ${retrying ? "payout-routing-card-retry" : ""}`}>
      <CardContent aria-live="polite">
        <div className="payout-route-scene" aria-label={status} role="status">
          <div className="payout-bolt-stage" aria-hidden="true">
            <svg viewBox="0 0 168 184">
              {payoutBoltLanes.map(({ delay, lane }) => (
                <path className={`payout-bolt-glow ${delay} ${lane}`} d={boltPath} key={`glow-${lane}`} />
              ))}
              {payoutBoltLanes.map(({ delay, lane }) => (
                <path className={`payout-bolt ${delay} ${lane}`} d={boltPath} key={lane} />
              ))}
            </svg>
          </div>
          <div className="payout-route-robot" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <g className="payout-route-robot-lines">
                <path d="M20 9V7a2 2 0 0 0-2-2h-3a3 3 0 0 0-6 0H6a2 2 0 0 0-2 2v2a3 3 0 0 0-3 3 3 3 0 0 0 3 3v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4a3 3 0 0 0 3-3 3 3 0 0 0-3-3Z" />
                <circle className="payout-route-eye" cx="9" cy="11.5" r="1" />
                <circle className="payout-route-eye" cx="15" cy="11.5" r="1" />
                <path d="M8 17h8" />
              </g>
            </svg>
          </div>
        </div>
        <h2>{title}</h2>
        <div className="payout-routing-copy">
          <strong>{retrying ? "Looking for a new payment route…" : "Finding a payment route…"}</strong>
          <p>{body}</p>
        </div>
      </CardContent>
    </Card>
  );
}
