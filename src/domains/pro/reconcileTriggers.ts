import {
  markProOrderActionFinished,
  markProOrderActionStarted,
  type GarageReconcileController
} from "@/domains/pro/garageReconciler";
import {
  subscribeCoordinatorOrderActionActivity,
  type CoordinatorOrderActionActivity
} from "@/domains/orders/orderActivity";
import {
  subscribeOrderChangeNotifications,
  type OrderChangeNotification
} from "@/domains/orders/orderChangeNotifications";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import type { ReconcileReason } from "@/domains/pro/pro.types";
import { subscribeRefreshIntents, type RefreshReason } from "@/domains/transport/refreshIntents";
import { desktopBackgroundNotificationsEnabled } from "@/domains/transport/tauriBridge";
import { hasActionableOrderDeadline } from "@/domains/orders/orderStateMachine";

type ReconcileTriggerOptions = {
  controller: GarageReconcileController;
  proEnabled: () => boolean;
  reconcileCurrent: (reason: ReconcileReason) => Promise<void>;
  intervalMs?: number;
  debounceMs?: number;
};

export const PRO_ORDER_CHANGE_CONSUMER_ID = "pro-reconcile";

export function registerReconcileTriggers(options: ReconcileTriggerOptions): () => void {
  const intervalMs = options.intervalMs ?? 60_000;
  let intervalTimer: number | undefined;
  let stopped = false;

  const run = (reason: ReconcileReason) => {
    if (stopped) return;
    const operation = options.proEnabled()
      ? options.controller.reconcileAll(reason)
      : options.reconcileCurrent(reason);
    void operation.catch(() => undefined);
  };

  const onLifecycle = (reason: RefreshReason) => {
    if (reason === "tor-reconnected") options.controller.invalidateEpoch();
    run(reconcileReason(reason));
  };
  const onOrderHint = (notification: OrderChangeNotification) => {
    if (!options.proEnabled()) return false;
    const operation = notification.source === "nostr"
      ? options.controller.handleOrderHint(notification)
      : options.controller.handleNativeOrderHint(notification);
    return operation.catch(() => false);
  };
  const onOrderAction = (activity: CoordinatorOrderActionActivity) => {
    if (activity.phase === "start") {
      markProOrderActionStarted(activity);
      return;
    }
    markProOrderActionFinished(activity);
    // A complete foreground response has already passed through the order
    // activity bridge, which archives terminal trades before removing them.
    // Never independently remove the row here: doing so could discard the
    // only recoverable terminal snapshot when an action response was partial.
    if (activity.snapshotApplied) return;
    void options.controller.reconcileOrder({
      slotId: activity.slotId,
      shortAlias: activity.shortAlias,
      orderId: activity.orderId
    }, "order-action").catch(() => undefined);
  };

  const stopLifecycle = subscribeRefreshIntents(onLifecycle);
  const stopOrderActions = subscribeCoordinatorOrderActionActivity(onOrderAction);
  const stopOrderHints = subscribeOrderChangeNotifications(onOrderHint, {
    consumerId: PRO_ORDER_CHANGE_CONSUMER_ID
  });

  intervalTimer = window.setInterval(() => {
    if (
      options.proEnabled()
      && (document.visibilityState === "visible" || desktopBackgroundNotificationsEnabled())
    ) run("interval");
  }, intervalMs);

  return () => {
    stopped = true;
    if (intervalTimer !== undefined) window.clearInterval(intervalTimer);
    stopLifecycle();
    stopOrderActions();
    stopOrderHints();
  };
}

function reconcileReason(reason: RefreshReason): ReconcileReason {
  if (reason === "focus") return "window-focus";
  if (reason === "resume") return "visibility-resume";
  return reason;
}

export function registerExpiryReconcileTrigger(
  controller: GarageReconcileController,
  now: () => number = Date.now
): () => void {
  let timer: number | undefined;
  let stopped = false;

  const schedule = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    if (stopped) return;
    const currentTime = now();
    const next = Object.values(useProTradeIndexStore.getState().snapshots)
      .map((snapshot) => ({ snapshot, deadline: Date.parse(snapshot.order?.expires_at ?? "") }))
      .filter(({ snapshot, deadline }) => snapshot.freshness !== "refreshing"
        && Boolean(snapshot.order && hasActionableOrderDeadline(snapshot.order))
        && Number.isFinite(deadline)
        && deadline > currentTime)
      .sort((left, right) => left.deadline - right.deadline)[0];
    if (!next) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      void controller.reconcileOrder(next.snapshot.locator, "countdown-expiry")
        .catch(() => undefined)
        .finally(schedule);
    }, Math.min(next.deadline - currentTime + 250, 2_147_000_000));
  };

  const unsubscribe = useProTradeIndexStore.subscribe(schedule);
  schedule();
  return () => {
    stopped = true;
    unsubscribe();
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
