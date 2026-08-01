import {
  markProOrderActionFinished,
  markProOrderActionStarted,
  type GarageReconcileController
} from "@/domains/pro/garageReconciler";
import {
  subscribeCoordinatorOrderActionActivity,
  type CoordinatorOrderActionActivity
} from "@/domains/orders/orderActivity";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import type { OrderHint, ReconcileReason } from "@/domains/pro/pro.types";
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
  const onOrderHint = (event: Event) => {
    const hint = validOrderHint((event as CustomEvent<unknown>).detail);
    if (hint) void options.controller.handleOrderHint(hint).catch(() => undefined);
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
  window.addEventListener("robosats:order-hint", onOrderHint);

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
    window.removeEventListener("robosats:order-hint", onOrderHint);
  };
}

function reconcileReason(reason: RefreshReason): ReconcileReason {
  if (reason === "focus") return "window-focus";
  if (reason === "resume") return "visibility-resume";
  if (reason === "notification") return "nostr-hint";
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

function validOrderHint(value: unknown): OrderHint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const hint = value as Partial<OrderHint>;
  if (!isString(hint.recipientPubkey) || !isString(hint.coordinatorPubkey)) return undefined;
  if (!isString(hint.eventId) || !isFiniteNumber(hint.createdAt)) return undefined;
  if (hint.shortAlias !== undefined && !isString(hint.shortAlias)) return undefined;
  if (hint.orderId !== undefined && (!Number.isInteger(hint.orderId) || hint.orderId <= 0)) return undefined;
  if (hint.status !== undefined && !Number.isInteger(hint.status)) return undefined;
  return hint as OrderHint;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
