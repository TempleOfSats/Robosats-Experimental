import { tradeAudioEventForOrderTransition } from "@/domains/audio/audioAssets";
import { playTradeAudio } from "@/domains/audio/audioController";
import { showDesktopOrderNotification } from "@/domains/notifications/desktopNotifications";
import { deliverChatFeedback } from "@/domains/notifications/tradeFeedback";
import {
  type CoordinatorOrderObservation,
  subscribeCoordinatorOrderActivity
} from "@/domains/orders/orderActivity";
import { tradeStatusLabel } from "@/domains/orders/orderStatus";
import type { OrderDto } from "@/domains/orders/order.types";
import { shouldPlayOrderFeedbackAudio } from "@/domains/notifications/orderFeedbackVisibility";
import { useGarageStore } from "@/domains/garage/garageStore";
import { disputeOutcomeForCurrentRobot, getTradeViewState } from "@/domains/orders/orderStateMachine";

type FeedbackSnapshot = Pick<OrderDto, "chat_last_index" | "invoice_expired" | "pending_cancel" | "status"> & {
  successPanel: boolean;
};

const snapshots = new Map<string, FeedbackSnapshot>();
const successfulAudioKeys = new Set<string>();
const recentNotifications = new Map<string, number>();
const NOTIFICATION_DEDUP_TTL_MS = 120_000;
let stopRuntime: (() => void) | undefined;

export function startOrderFeedbackRuntime(): () => void {
  if (stopRuntime) return stopRuntime;
  stopRuntime = subscribeCoordinatorOrderActivity(handleObservation, { replay: true });
  return stopRuntime;
}

export function stopOrderFeedbackRuntimeForTests(): void {
  stopRuntime?.();
  stopRuntime = undefined;
  snapshots.clear();
  successfulAudioKeys.clear();
  recentNotifications.clear();
}

function handleObservation(observation: CoordinatorOrderObservation): void {
  if (!observation.authoritative) return;
  const key = `${observation.slotId}:${observation.shortAlias}:${observation.order.id}`;
  const next = feedbackSnapshot(observation.order);
  const previous = snapshots.get(key);
  const robotHashId = useGarageStore.getState().slots.find(
    (slot) => slot.tokenSHA256 === observation.slotId
  )?.hashId;
  snapshots.set(key, next);
  if (!previous) return;

  if ((next.chat_last_index ?? 0) > (previous.chat_last_index ?? 0)) {
    deliverChatFeedback({
      lastIndex: next.chat_last_index ?? 0,
      orderId: observation.order.id,
      robotHashId,
      shortAlias: observation.shortAlias
    });
  }

  const successEdge = !previous.successPanel && next.successPanel;
  const successAlreadyPlayed = successfulAudioKeys.has(key);
  const audio = feedbackAudio(previous, observation.order.status, successEdge, successAlreadyPlayed);
  const shouldPlayAudio = Boolean(audio) && shouldPlayOrderFeedbackAudio(observation.shortAlias, observation.order.id);
  if (audio && shouldPlayAudio) {
    if (audio === "successful") successfulAudioKeys.add(key);
    void playTradeAudio(audio).catch(() => undefined);
  }
  const message = orderFeedbackMessage(previous, observation.order);
  if (!message) return;
  const dedupKey = `${key}:${message}`;
  const now = Date.now();
  const lastFired = recentNotifications.get(dedupKey);
  if (lastFired !== undefined && now - lastFired < NOTIFICATION_DEDUP_TTL_MS) return;
  recentNotifications.set(dedupKey, now);
  for (const [k, t] of recentNotifications) {
    if (now - t > NOTIFICATION_DEDUP_TTL_MS) recentNotifications.delete(k);
  }
  void showDesktopOrderNotification(
    observation.order.id,
    observation.shortAlias,
    message,
    robotHashId
  );
}

function feedbackAudio(
  previous: FeedbackSnapshot,
  nextStatus: number,
  successEdge: boolean,
  successAlreadyPlayed: boolean
): ReturnType<typeof tradeAudioEventForOrderTransition> | "successful" {
  if (successEdge) return successAlreadyPlayed ? null : "successful";
  if (previous.successPanel) return null;
  return tradeAudioEventForOrderTransition(previous.status, nextStatus);
}

function feedbackSnapshot(order: OrderDto): FeedbackSnapshot {
  return {
    chat_last_index: order.chat_last_index,
    invoice_expired: order.invoice_expired,
    pending_cancel: order.pending_cancel,
    status: order.status,
    successPanel: getTradeViewState(order).panel === "success"
  };
}

function orderFeedbackMessage(previous: FeedbackSnapshot, order: OrderDto): string | undefined {
  if (!previous.pending_cancel && order.pending_cancel) {
    return "Your peer requested collaborative cancellation";
  }
  if (!previous.invoice_expired && order.invoice_expired) {
    return "A new payout invoice is required";
  }
  if (previous.status !== order.status) {
    const disputeOutcome = disputeOutcomeForCurrentRobot(order);
    if (disputeOutcome === "won") return "Dispute resolved in your favor";
    if (disputeOutcome === "lost") return "Dispute resolved in favor of your peer";
    return tradeStatusLabel(order);
  }
  return undefined;
}
