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

type FeedbackSnapshot = Pick<
  OrderDto,
  "chat_last_index" | "invoice_expired" | "pending_cancel" | "status"
>;

const snapshots = new Map<string, FeedbackSnapshot>();
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
}

function handleObservation(observation: CoordinatorOrderObservation): void {
  if (!observation.authoritative) return;
  const key = `${observation.slotId}:${observation.shortAlias}:${observation.order.id}`;
  const next = feedbackSnapshot(observation.order);
  const previous = snapshots.get(key);
  snapshots.set(key, next);
  if (!previous) return;

  if ((next.chat_last_index ?? 0) > (previous.chat_last_index ?? 0)) {
    deliverChatFeedback({
      lastIndex: next.chat_last_index ?? 0,
      orderId: observation.order.id,
      shortAlias: observation.shortAlias
    });
  }

  const message = orderFeedbackMessage(previous, observation.order);
  if (!message) return;
  const audio = tradeAudioEventForOrderTransition(previous.status, observation.order.status);
  if (audio && shouldPlayOrderFeedbackAudio(observation.shortAlias, observation.order.id)) {
    void playTradeAudio(audio).catch(() => undefined);
  }
  void showDesktopOrderNotification(
    observation.order.id,
    observation.shortAlias,
    message
  );
}

function feedbackSnapshot(order: OrderDto): FeedbackSnapshot {
  return {
    chat_last_index: order.chat_last_index,
    invoice_expired: order.invoice_expired,
    pending_cancel: order.pending_cancel,
    status: order.status
  };
}

export function orderFeedbackMessage(previous: FeedbackSnapshot, order: OrderDto): string | undefined {
  if (!previous.pending_cancel && order.pending_cancel) {
    return "Your peer requested collaborative cancellation";
  }
  if (!previous.invoice_expired && order.invoice_expired) {
    return "A new payout invoice is required";
  }
  if (previous.status !== order.status) return tradeStatusLabel(order);
  return undefined;
}
