import {
  orderChangeMatches,
  subscribeOrderChangeNotifications,
  type OrderChangeNotification
} from "@/domains/orders/orderChangeNotifications";
import type { OrderLoadResult } from "@/domains/orders/orderStore";
import { subscribeRefreshIntents } from "@/domains/transport/refreshIntents";

export type OrderLoadRecoveryPhase = "loading" | "waiting-to-retry" | "retrying" | "idle";

type OrderRefreshLocator = {
  slotId?: string;
  shortAlias: string;
  orderId: number;
};

type OrderLoadRecoveryOptions = {
  activeDelayMs?(): number | undefined;
  coordinatorEndpoint?: string;
  locator: OrderRefreshLocator;
  load(reason: "initial" | "lifecycle" | "maintenance" | "manual" | "poll"): Promise<OrderLoadResult>;
  onPhaseChange(phase: OrderLoadRecoveryPhase): void;
  autoRetryWindowMs?: number;
  pauseWhileHidden?: boolean;
  retryDelayMs?: number;
};

type OrderLoadRecoveryRegistration = {
  retry(): void;
  reschedule(): void;
  dispose(): void;
};

const MIN_RETRY_DELAY_MS = 1_500;
const RETRY_JITTER_MS = 1_000;
const DEFAULT_AUTO_RETRY_WINDOW_MS = 8_000;
const HIDDEN_REFRESH_DELAY_MS = 5 * 60_000;
const activeColdInitialLoads = new Map<string, Promise<OrderLoadResult>>();

type ColdInitialLoad = {
  promise: Promise<OrderLoadResult>;
  reused: boolean;
};

type HintLoadWaiter = {
  resolve: (acknowledged: boolean) => void;
  targetGeneration: number;
};

export function registerOrderLoadRecovery(options: OrderLoadRecoveryOptions): OrderLoadRecoveryRegistration {
  let activeLoad: Promise<OrderLoadResult> | undefined;
  let activeGeneration = 0;
  let autoRetryAvailable = true;
  let disposed = false;
  let freshLoadQueued = false;
  let generation = 0;
  let hintLoadWaiters: HintLoadWaiter[] = [];
  let initializing = true;
  let phase: OrderLoadRecoveryPhase | undefined;
  let pollTimer: number | undefined;
  let replayedOrderChange = false;
  let retryTimer: number | undefined;

  const setPhase = (next: OrderLoadRecoveryPhase) => {
    if (disposed || phase === next) return;
    phase = next;
    options.onPhaseChange(next);
  };

  const cancelAutoRetry = () => {
    autoRetryAvailable = false;
    if (retryTimer === undefined) return;
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
  };
  const waitForHintLoad = (targetGeneration: number): Promise<boolean> =>
    new Promise((resolve) => {
      if (disposed) {
        resolve(false);
        return;
      }
      hintLoadWaiters.push({ resolve, targetGeneration });
    });
  const settleHintLoads = (completedGeneration: number, acknowledged: boolean) => {
    const pending: HintLoadWaiter[] = [];
    for (const waiter of hintLoadWaiters) {
      if (waiter.targetGeneration <= completedGeneration) waiter.resolve(acknowledged);
      else pending.push(waiter);
    }
    hintLoadWaiters = pending;
  };
  const retargetHintLoads = (fromGeneration: number, toGeneration: number) => {
    for (const waiter of hintLoadWaiters) {
      if (waiter.targetGeneration === fromGeneration) waiter.targetGeneration = toGeneration;
    }
  };
  const discardUnstartedHintLoads = () => {
    const started: HintLoadWaiter[] = [];
    for (const waiter of hintLoadWaiters) {
      if (waiter.targetGeneration <= generation) started.push(waiter);
      else waiter.resolve(false);
    }
    hintLoadWaiters = started;
  };
  const clearPoll = () => {
    if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    pollTimer = undefined;
  };
  const schedule = () => {
    clearPoll();
    if (disposed || activeLoad) return;
    const activeDelay = options.activeDelayMs?.();
    if (activeDelay === undefined || (document.hidden && options.pauseWhileHidden)) return;
    const delay = document.hidden ? HIDDEN_REFRESH_DELAY_MS : activeDelay;
    pollTimer = window.setTimeout(() => {
      pollTimer = undefined;
      run(document.hidden ? "maintenance" : "poll");
    }, delay);
  };

  const run = (
    reason: "initial" | "lifecycle" | "maintenance" | "manual" | "poll",
    nextPhase?: OrderLoadRecoveryPhase,
    mayScheduleAutoRetry = false,
    freshAfterActive = false
  ): { generation: number; reusedColdInitial: boolean } | undefined => {
    if (disposed) return;
    if (nextPhase) setPhase(nextPhase);
    if (activeLoad) {
      if (freshAfterActive) freshLoadQueued = true;
      return;
    }

    const runGeneration = ++generation;
    activeGeneration = runGeneration;
    const startedAt = Date.now();
    const coldInitial = reason === "initial" ? coldInitialLoad(options, () => options.load(reason)) : undefined;
    const result = coldInitial?.promise ?? startOrderLoad(() => options.load(reason));
    activeLoad = result;
    void result
      .then(
        (loadResult) => {
          if (disposed || freshLoadQueued) return;
          const fastTransientFailure =
            loadResult.status === "failed" &&
            loadResult.failure.kind === "transient" &&
            Date.now() - startedAt <= (options.autoRetryWindowMs ?? DEFAULT_AUTO_RETRY_WINDOW_MS);
          if (
            mayScheduleAutoRetry &&
            autoRetryAvailable &&
            (fastTransientFailure || (loadResult.status === "unchanged" && !loadResult.order))
          ) {
            autoRetryAvailable = false;
            setPhase("waiting-to-retry");
            const delay = options.retryDelayMs ?? MIN_RETRY_DELAY_MS + Math.round(Math.random() * RETRY_JITTER_MS);
            retryTimer = window.setTimeout(() => {
              retryTimer = undefined;
              run("initial", "retrying", false);
            }, delay);
            return;
          }
          setPhase("idle");
        },
        () => {
          if (!disposed && !freshLoadQueued) setPhase("idle");
        }
      )
      .finally(() => {
        if (activeLoad === result) {
          activeLoad = undefined;
          activeGeneration = 0;
        }
        settleHintLoads(runGeneration, true);
        if (disposed) return;
        if (freshLoadQueued) {
          freshLoadQueued = false;
          run("lifecycle", "retrying");
          return;
        }
        schedule();
      });
    return { generation: runGeneration, reusedColdInitial: coldInitial?.reused ?? false };
  };

  const stopLifecycle = subscribeRefreshIntents((reason) => {
    clearPoll();
    cancelAutoRetry();
    run("lifecycle", "retrying", false, reason === "tor-reconnected");
  });
  const refreshChangedOrder = (notification: OrderChangeNotification) => {
    if (!orderChangeMatches(notification, options.locator)) return false;
    const targetGeneration = initializing ? 1 : activeLoad ? activeGeneration + 1 : generation + 1;
    const acknowledged = waitForHintLoad(targetGeneration);
    if (initializing) {
      replayedOrderChange = true;
      return acknowledged;
    }
    clearPoll();
    cancelAutoRetry();
    run("lifecycle", "retrying", false, true);
    return acknowledged;
  };
  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") schedule();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  const stopOrderChanges = subscribeOrderChangeNotifications(refreshChangedOrder, {
    consumerId: orderLoadConsumerId(options.locator)
  });
  initializing = false;
  if (options.activeDelayMs?.() === undefined) {
    const initialRun = run("initial", "loading", true);
    if (replayedOrderChange && initialRun?.reusedColdInitial) {
      retargetHintLoads(initialRun.generation, initialRun.generation + 1);
      freshLoadQueued = true;
    }
  } else if (replayedOrderChange) {
    run("lifecycle", "retrying");
  } else {
    schedule();
  }

  return {
    retry: () => {
      clearPoll();
      cancelAutoRetry();
      run("manual", "retrying");
    },
    reschedule: () => {
      clearPoll();
      if (options.activeDelayMs?.() !== undefined) cancelAutoRetry();
      schedule();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      freshLoadQueued = false;
      discardUnstartedHintLoads();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      clearPoll();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopLifecycle();
      stopOrderChanges();
    }
  };
}

export function resetOrderLoadRecoveryForTests(): void {
  activeColdInitialLoads.clear();
}

export function isColdOrderLoadActive(coordinatorEndpoint: string | undefined, locator: OrderRefreshLocator): boolean {
  const key = coldInitialLoadKey({ coordinatorEndpoint, locator });
  return key !== undefined && activeColdInitialLoads.has(key);
}

export function discardColdOrderLoad(coordinatorEndpoint: string | undefined, locator: OrderRefreshLocator): boolean {
  const key = coldInitialLoadKey({ coordinatorEndpoint, locator });
  return key !== undefined && activeColdInitialLoads.delete(key);
}

function orderLoadConsumerId(locator: OrderRefreshLocator): string {
  return `order-load:${locator.slotId ?? "*"}:${locator.shortAlias}:${locator.orderId}`;
}

function coldInitialLoad(
  options: Pick<OrderLoadRecoveryOptions, "coordinatorEndpoint" | "locator">,
  load: () => Promise<OrderLoadResult>
): ColdInitialLoad {
  const key = coldInitialLoadKey(options);
  if (!key) return { promise: startOrderLoad(load), reused: false };
  const active = activeColdInitialLoads.get(key);
  if (active) return { promise: active, reused: true };
  const result = startOrderLoad(load);
  activeColdInitialLoads.set(key, result);
  const clear = () => {
    if (activeColdInitialLoads.get(key) === result) activeColdInitialLoads.delete(key);
  };
  void result.then(clear, clear);
  return { promise: result, reused: false };
}

function coldInitialLoadKey({
  coordinatorEndpoint,
  locator
}: Pick<OrderLoadRecoveryOptions, "coordinatorEndpoint" | "locator">): string | undefined {
  if (!coordinatorEndpoint) return undefined;
  return JSON.stringify([coordinatorEndpoint, locator.slotId ?? "*", locator.shortAlias, locator.orderId]);
}

function startOrderLoad(load: () => Promise<OrderLoadResult>): Promise<OrderLoadResult> {
  try {
    return Promise.resolve(load());
  } catch (error) {
    return Promise.reject(error);
  }
}
