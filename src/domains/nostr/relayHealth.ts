export type RelayHealthSnapshot = {
  failures: number;
  latencyMs: number;
  lastSuccessAt: number;
  lastFailureAt: number;
  connectedAt?: number;
  lastEventAt?: number;
  lastEoseAt?: number;
  lastErrorAt?: number;
};

const registry = new Map<string, RelayHealthSnapshot>();

export function noteRelaySuccess(relay: string, latencyMs: number): void {
  const key = normalizeRelayUrl(relay);
  const previous = registry.get(key);
  registry.set(key, {
    ...previous,
    failures: Math.max(0, (previous?.failures ?? 0) - 1),
    latencyMs: previous ? Math.round(previous.latencyMs * 0.7 + latencyMs * 0.3) : Math.max(0, latencyMs),
    lastSuccessAt: Date.now(),
    lastFailureAt: previous?.lastFailureAt ?? 0
  });
}

export function noteRelayFailure(relay: string): void {
  const key = normalizeRelayUrl(relay);
  const previous = registry.get(key);
  const now = Date.now();
  registry.set(key, {
    ...previous,
    failures: Math.min(10, (previous?.failures ?? 0) + 1),
    latencyMs: previous?.latencyMs ?? 20_000,
    lastSuccessAt: previous?.lastSuccessAt ?? 0,
    lastFailureAt: now,
    lastErrorAt: now
  });
}

export function noteRelayConnected(relay: string): void {
  updateLiveState(relay, { connectedAt: Date.now(), lastErrorAt: undefined });
}

export function noteRelayEvent(relay: string): void {
  updateLiveState(relay, { lastEventAt: Date.now() });
  noteRelaySuccess(relay, 0);
}

export function noteRelayEose(relay: string, latencyMs: number): void {
  updateLiveState(relay, { lastEoseAt: Date.now() });
  noteRelaySuccess(relay, latencyMs);
}

export function noteRelayDisconnected(relay: string): void {
  updateLiveState(relay, { connectedAt: undefined, lastErrorAt: Date.now() });
  noteRelayFailure(relay);
}

export function isRelayLiveHealthy(relay: string, now = Date.now()): boolean {
  const state = registry.get(normalizeRelayUrl(relay));
  if (!state?.connectedAt || (state.lastErrorAt ?? 0) >= state.connectedAt) return false;
  const activityAt = Math.max(state.lastEventAt ?? 0, state.lastEoseAt ?? 0, state.connectedAt);
  return now - activityAt < 6 * 60_000;
}

export function orderRelays(relays: string[]): string[] {
  return [...new Set(relays)].sort((left, right) => {
    const leftState = registry.get(normalizeRelayUrl(left));
    const rightState = registry.get(normalizeRelayUrl(right));
    if (!leftState && !rightState) return 0;
    if (!leftState) return 1;
    if (!rightState) return -1;
    return leftState.failures - rightState.failures
      || leftState.latencyMs - rightState.latencyMs
      || rightState.lastSuccessAt - leftState.lastSuccessAt;
  });
}

export function relayHealthSnapshot(relay: string): RelayHealthSnapshot | undefined {
  const snapshot = registry.get(normalizeRelayUrl(relay));
  return snapshot ? { ...snapshot } : undefined;
}

export function normalizeRelayUrl(relay: string): string {
  try {
    const url = new URL(relay.trim());
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return relay.trim().replace(/\/+$/, "").toLowerCase();
  }
}

export function resetRelayHealthForTests(): void {
  registry.clear();
}

function updateLiveState(relay: string, patch: Partial<RelayHealthSnapshot>): void {
  const key = normalizeRelayUrl(relay);
  const previous = registry.get(key);
  registry.set(key, {
    failures: previous?.failures ?? 0,
    latencyMs: previous?.latencyMs ?? 20_000,
    lastSuccessAt: previous?.lastSuccessAt ?? 0,
    lastFailureAt: previous?.lastFailureAt ?? 0,
    ...previous,
    ...patch
  });
}
