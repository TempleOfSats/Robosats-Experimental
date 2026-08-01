import type { OrderLoadResult } from "@/domains/orders/orderStore";
import { runRefreshIntent, subscribeRefreshIntents, type RefreshReason } from "@/domains/transport/refreshIntents";

export type OrderLoadRecoveryPhase = "loading" | "waiting-to-retry" | "retrying" | "idle";

type LoadedOrderRefreshOptions = {
  activeDelayMs(): number;
  key: string;
  load(reason: "lifecycle" | "maintenance" | "poll"): Promise<OrderLoadResult>;
  pauseWhileHidden: boolean;
};

type OrderLoadRecoveryOptions = {
  key: string;
  load(reason: "initial" | "lifecycle" | "manual"): Promise<OrderLoadResult>;
  onPhaseChange(phase: OrderLoadRecoveryPhase): void;
  autoRetryWindowMs?: number;
  retryDelayMs?: number;
};

type OrderLoadRecoveryRegistration = {
  retry(): void;
  dispose(): void;
};

const MIN_RETRY_DELAY_MS = 1_500;
const RETRY_JITTER_MS = 1_000;
const DEFAULT_AUTO_RETRY_WINDOW_MS = 8_000;
const HIDDEN_REFRESH_DELAY_MS = 5 * 60_000;

export function registerOrderLoadRecovery(options: OrderLoadRecoveryOptions): OrderLoadRecoveryRegistration {
  let disposed = false;
  let autoRetryAvailable = true;
  let retryTimer: number | undefined;
  let phase: OrderLoadRecoveryPhase | undefined;
  let runGeneration = 0;

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

  const run = (
    reason: "initial" | "lifecycle" | "manual",
    nextPhase: OrderLoadRecoveryPhase,
    mayScheduleAutoRetry: boolean,
    afterActive = false
  ) => {
    const generation = ++runGeneration;
    const startedAt = Date.now();
    setPhase(nextPhase);
    void runRefreshIntent(options.key, () => (disposed ? unchangedOrderLoadResult() : options.load(reason)), {
      afterActive
    }).then(
      (result) => {
        if (disposed || generation !== runGeneration) return;
        const fastTransientFailure =
          result.status === "failed" &&
          result.failure.kind === "transient" &&
          Date.now() - startedAt <= (options.autoRetryWindowMs ?? DEFAULT_AUTO_RETRY_WINDOW_MS);
        if (
          mayScheduleAutoRetry &&
          autoRetryAvailable &&
          (fastTransientFailure || (result.status === "unchanged" && !result.order))
        ) {
          autoRetryAvailable = false;
          setPhase("waiting-to-retry");
          const delay = options.retryDelayMs ?? MIN_RETRY_DELAY_MS + Math.round(Math.random() * RETRY_JITTER_MS);
          retryTimer = window.setTimeout(() => {
            retryTimer = undefined;
            if (disposed) return;
            run("initial", "retrying", false);
          }, delay);
          return;
        }
        setPhase("idle");
      },
      () => {
        if (generation !== runGeneration) return;
        setPhase("idle");
      }
    );
  };

  const stopLifecycle = subscribeRefreshIntents((reason) => {
    if (disposed) return;
    cancelAutoRetry();
    run("lifecycle", "retrying", false, reason === "tor-reconnected");
  });

  run("initial", "loading", true);

  return {
    retry: () => {
      if (disposed) return;
      cancelAutoRetry();
      run("manual", "retrying", false);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      stopLifecycle();
    }
  };
}

export function registerLoadedOrderRefresh(options: LoadedOrderRefreshOptions): () => void {
  let disposed = false;
  let generation = 0;
  let timer: number | undefined;

  const schedule = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    if (disposed || (document.hidden && options.pauseWhileHidden)) return;
    const scheduledGeneration = generation;
    const delay = document.hidden ? HIDDEN_REFRESH_DELAY_MS : options.activeDelayMs();
    timer = window.setTimeout(async () => {
      timer = undefined;
      await runRefreshIntent(options.key, () => options.load(document.hidden ? "maintenance" : "poll"));
      if (disposed || scheduledGeneration !== generation) return;
      schedule();
    }, delay);
  };
  const refreshNow = (reason: RefreshReason) => {
    const refreshGeneration = ++generation;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    void runRefreshIntent(options.key, () => (disposed ? unchangedOrderLoadResult() : options.load("lifecycle")), {
      afterActive: reason === "tor-reconnected"
    }).finally(() => {
      if (!disposed && refreshGeneration === generation) schedule();
    });
  };
  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") schedule();
  };

  schedule();
  document.addEventListener("visibilitychange", onVisibilityChange);
  const stopLifecycle = subscribeRefreshIntents(refreshNow);
  return () => {
    disposed = true;
    generation += 1;
    if (timer !== undefined) window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    stopLifecycle();
  };
}

function unchangedOrderLoadResult(): OrderLoadResult {
  return { status: "unchanged" };
}
