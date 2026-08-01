const activeIntents = new Map<string, Promise<unknown>>();
const REFRESH_EVENT = "robosats:refresh-intent";
export const ORDER_CHANGE_HINT_REFRESH_EVENT = "robosats:order-change-hint-refresh";

export type RefreshReason =
  | "focus"
  | "online"
  | "notification"
  | "resume"
  | "tor-ready"
  | "tor-reconnected";

type RefreshIntentEvent = CustomEvent<{ reason: RefreshReason }>;

let lifecycleCleanup: (() => void) | undefined;

type RefreshIntentOptions = {
  afterActive?: boolean;
};

export function runRefreshIntent<T>(
  key: string,
  refresh: () => T | Promise<T>,
  options: RefreshIntentOptions = {}
): Promise<T> {
  const active = activeIntents.get(key) as Promise<T> | undefined;
  if (active) {
    if (!options.afterActive) return active;
    return active.then(
      () => runRefreshIntent(key, refresh),
      () => runRefreshIntent(key, refresh)
    );
  }
  let refreshResult: T | Promise<T>;
  try {
    refreshResult = refresh();
  } catch (error) {
    refreshResult = Promise.reject(error);
  }
  const intent = Promise.resolve(refreshResult).finally(() => {
      if (activeIntents.get(key) === intent) activeIntents.delete(key);
    });
  activeIntents.set(key, intent);
  return intent;
}

export function resetRefreshIntentsForTests(): void {
  activeIntents.clear();
}

export function installRefreshIntentLifecycle(): () => void {
  if (lifecycleCleanup) return lifecycleCleanup;
  let timer: number | undefined;
  let pendingReason: RefreshReason | undefined;
  let recentImmediate: { at: number; reason: RefreshReason } | undefined;

  const emit = (reason: RefreshReason, immediate = false) => {
    if (
      recentImmediate
      && Date.now() - recentImmediate.at < 750
      && preferredReason(recentImmediate.reason, reason) === recentImmediate.reason
    ) return;
    pendingReason = preferredReason(pendingReason, reason);
    if (timer !== undefined) window.clearTimeout(timer);
    const dispatch = () => {
      timer = undefined;
      const nextReason = pendingReason;
      pendingReason = undefined;
      if (nextReason) window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { detail: { reason: nextReason } }));
    };
    if (immediate) {
      recentImmediate = { at: Date.now(), reason };
      dispatch();
    } else timer = window.setTimeout(dispatch, 750);
  };
  const onFocus = () => emit("focus");
  const onOnline = () => emit("online");
  const onNativeResume = () => emit("resume");
  const onNativeOrderHint = () => emit("notification", true);
  const onOrderChangeHint = () => emit("notification", true);
  const onTorReady = () => emit("tor-ready", true);
  const onTorReconnected = () => emit("tor-reconnected", true);
  const onVisibility = () => {
    if (document.visibilityState === "visible") emit("resume");
  };

  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);
  window.addEventListener("robosats:native-resume", onNativeResume);
  window.addEventListener("robosats:native-order-hint", onNativeOrderHint);
  window.addEventListener(ORDER_CHANGE_HINT_REFRESH_EVENT, onOrderChangeHint);
  window.addEventListener("robosats:tor-ready", onTorReady);
  window.addEventListener("robosats:tor-reconnected", onTorReconnected);
  document.addEventListener("visibilitychange", onVisibility);

  lifecycleCleanup = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("robosats:native-resume", onNativeResume);
    window.removeEventListener("robosats:native-order-hint", onNativeOrderHint);
    window.removeEventListener(ORDER_CHANGE_HINT_REFRESH_EVENT, onOrderChangeHint);
    window.removeEventListener("robosats:tor-ready", onTorReady);
    window.removeEventListener("robosats:tor-reconnected", onTorReconnected);
    document.removeEventListener("visibilitychange", onVisibility);
    recentImmediate = undefined;
    lifecycleCleanup = undefined;
  };
  return lifecycleCleanup;
}

export function subscribeRefreshIntents(listener: (reason: RefreshReason) => void): () => void {
  const handler = (event: Event) => listener((event as RefreshIntentEvent).detail.reason);
  window.addEventListener(REFRESH_EVENT, handler);
  return () => window.removeEventListener(REFRESH_EVENT, handler);
}

function preferredReason(current: RefreshReason | undefined, next: RefreshReason): RefreshReason {
  const rank: Record<RefreshReason, number> = {
    focus: 0,
    resume: 1,
    online: 2,
    notification: 3,
    "tor-ready": 4,
    "tor-reconnected": 5
  };
  return current && rank[current] > rank[next] ? current : next;
}
