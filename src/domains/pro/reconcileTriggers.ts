import {
  markProOrderActionFinished,
  markProOrderActionStarted,
  type GarageReconcileController
} from "@/domains/pro/garageReconciler";
import { isTerminalForProDesk } from "@/domains/pro/proOrderActivity";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import type { OrderHint, ProTradeLocator, ReconcileReason } from "@/domains/pro/pro.types";

type ReconcileTriggerOptions = {
  controller: GarageReconcileController;
  proEnabled: () => boolean;
  reconcileCurrent: (reason: ReconcileReason) => Promise<void>;
  intervalMs?: number;
  debounceMs?: number;
};

export function registerReconcileTriggers(options: ReconcileTriggerOptions): () => void {
  const intervalMs = options.intervalMs ?? 60_000;
  const debounceMs = options.debounceMs ?? 750;
  let debounceTimer: number | undefined;
  let intervalTimer: number | undefined;
  let stopped = false;

  const run = (reason: ReconcileReason) => {
    if (stopped) return;
    const operation = options.proEnabled()
      ? options.controller.reconcileAll(reason)
      : options.reconcileCurrent(reason);
    void operation.catch(() => undefined);
  };

  const debounce = (reason: ReconcileReason) => {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => run(reason), debounceMs);
  };

  const onTorReady = () => run("tor-ready");
  const onTorReconnected = () => {
    options.controller.invalidateEpoch();
    run("tor-reconnected");
  };
  const onFocus = () => debounce("window-focus");
  const onVisibility = () => {
    if (document.visibilityState === "visible") debounce("visibility-resume");
  };
  const onNativeResume = () => debounce("native-resume");
  const onOnline = () => debounce("online");
  const onOrderHint = (event: Event) => {
    const hint = validOrderHint((event as CustomEvent<unknown>).detail);
    if (hint) void options.controller.handleOrderHint(hint).catch(() => undefined);
  };
  const onOrderActionStart = (event: Event) => {
    const locator = validLocator((event as CustomEvent<unknown>).detail);
    if (locator) markProOrderActionStarted(locator);
  };
  const onOrderActionComplete = (event: Event) => {
    const result = validOrderActionResult((event as CustomEvent<unknown>).detail);
    if (!result) return;
    markProOrderActionFinished(result);
    if (result.status !== undefined && result.isMaker !== undefined
      && isTerminalForProDesk(result.status, result.isMaker)) {
      useProTradeIndexStore.getState().removeTrade(result);
      return;
    }
    if (result.snapshotApplied) return;
    void options.controller.reconcileOrder(result, "order-action").catch(() => undefined);
  };

  window.addEventListener("robosats:tor-ready", onTorReady);
  window.addEventListener("robosats:tor-reconnected", onTorReconnected);
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);
  window.addEventListener("robosats:native-resume", onNativeResume);
  window.addEventListener("robosats:order-hint", onOrderHint);
  window.addEventListener("robosats:order-action-start", onOrderActionStart);
  window.addEventListener("robosats:order-action-complete", onOrderActionComplete);
  document.addEventListener("visibilitychange", onVisibility);

  intervalTimer = window.setInterval(() => {
    if (options.proEnabled() && document.visibilityState === "visible") run("interval");
  }, intervalMs);

  return () => {
    stopped = true;
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    if (intervalTimer !== undefined) window.clearInterval(intervalTimer);
    window.removeEventListener("robosats:tor-ready", onTorReady);
    window.removeEventListener("robosats:tor-reconnected", onTorReconnected);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("robosats:native-resume", onNativeResume);
    window.removeEventListener("robosats:order-hint", onOrderHint);
    window.removeEventListener("robosats:order-action-start", onOrderActionStart);
    window.removeEventListener("robosats:order-action-complete", onOrderActionComplete);
    document.removeEventListener("visibilitychange", onVisibility);
  };
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
      .filter(({ snapshot, deadline }) => snapshot.freshness !== "refreshing" && Number.isFinite(deadline) && deadline > currentTime)
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

function validLocator(value: unknown): ProTradeLocator | undefined {
  if (!value || typeof value !== "object") return undefined;
  const locator = value as Partial<ProTradeLocator>;
  if (!isString(locator.slotId) || !isString(locator.shortAlias)) return undefined;
  if (!Number.isInteger(locator.orderId) || (locator.orderId ?? 0) <= 0) return undefined;
  return locator as ProTradeLocator;
}

function validOrderActionResult(value: unknown): (ProTradeLocator & {
  status?: number;
  isMaker?: boolean;
  snapshotApplied?: boolean;
}) | undefined {
  const locator = validLocator(value);
  if (!locator) return undefined;
  const result = value as { status?: unknown; isMaker?: unknown; snapshotApplied?: unknown };
  if (result.status !== undefined && !Number.isInteger(result.status)) return undefined;
  if (result.isMaker !== undefined && typeof result.isMaker !== "boolean") return undefined;
  if (result.snapshotApplied !== undefined && typeof result.snapshotApplied !== "boolean") return undefined;
  return {
    ...locator,
    status: result.status as number | undefined,
    isMaker: result.isMaker as boolean | undefined,
    snapshotApplied: result.snapshotApplied as boolean | undefined
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
