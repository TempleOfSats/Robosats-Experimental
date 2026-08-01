export type RefreshReason =
  | "focus"
  | "online"
  | "resume"
  | "tor-ready"
  | "tor-reconnected";

type RefreshIntentListener = (reason: RefreshReason) => void;

const listeners = new Set<RefreshIntentListener>();
let lifecycleCleanup: (() => void) | undefined;

export function publishRefreshIntent(reason: RefreshReason): void {
  for (const listener of listeners) {
    try {
      listener(reason);
    } catch {
      // One refresh owner cannot prevent the other domains from recovering.
    }
  }
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
    const publish = () => {
      timer = undefined;
      const nextReason = pendingReason;
      pendingReason = undefined;
      if (nextReason) publishRefreshIntent(nextReason);
    };
    if (immediate) {
      recentImmediate = { at: Date.now(), reason };
      publish();
    } else {
      timer = window.setTimeout(publish, 750);
    }
  };
  const onFocus = () => emit("focus");
  const onOnline = () => emit("online");
  const onNativeResume = () => emit("resume");
  const onTorReady = () => emit("tor-ready", true);
  const onTorReconnected = () => emit("tor-reconnected", true);
  const onVisibility = () => {
    if (document.visibilityState === "visible") emit("resume");
  };

  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);
  window.addEventListener("robosats:native-resume", onNativeResume);
  window.addEventListener("robosats:tor-ready", onTorReady);
  window.addEventListener("robosats:tor-reconnected", onTorReconnected);
  document.addEventListener("visibilitychange", onVisibility);

  lifecycleCleanup = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("robosats:native-resume", onNativeResume);
    window.removeEventListener("robosats:tor-ready", onTorReady);
    window.removeEventListener("robosats:tor-reconnected", onTorReconnected);
    document.removeEventListener("visibilitychange", onVisibility);
    recentImmediate = undefined;
    lifecycleCleanup = undefined;
  };
  return lifecycleCleanup;
}

export function subscribeRefreshIntents(listener: RefreshIntentListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetRefreshIntentLifecycleForTests(): void {
  lifecycleCleanup?.();
  listeners.clear();
}

function preferredReason(
  current: RefreshReason | undefined,
  next: RefreshReason
): RefreshReason {
  const rank: Record<RefreshReason, number> = {
    focus: 0,
    resume: 1,
    online: 2,
    "tor-ready": 3,
    "tor-reconnected": 4
  };
  return current && rank[current] > rank[next] ? current : next;
}
