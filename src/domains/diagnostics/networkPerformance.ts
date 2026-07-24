import type { RequestPriority, RequestSource } from "@/domains/transport/apiClient";

export type NetworkOutcome =
  | "success"
  | "http-error"
  | "timeout"
  | "network-error"
  | "cancelled";

export type NetworkPerformanceEntry = {
  id: string;
  source: RequestSource | "nostr";
  priority?: RequestPriority;
  originHash: string;
  queuedMs?: number;
  transportMs?: number;
  totalMs: number;
  outcome: NetworkOutcome;
  cache?: "hit" | "miss";
  relayPhase?: "connect" | "first-event" | "eose" | "close";
  at: number;
};

const MAX_ENTRIES = 250;
const salt = randomSalt();
const entries: NetworkPerformanceEntry[] = [];
let sequence = 0;

export function recordNetworkPerformance(
  entry: Omit<NetworkPerformanceEntry, "id" | "originHash" | "at"> & { origin: string }
): void {
  const { origin, ...safeEntry } = entry;
  entries.push({
    ...safeEntry,
    id: `network-${++sequence}`,
    originHash: hashOrigin(origin),
    at: Date.now()
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function networkPerformanceSnapshot(): NetworkPerformanceEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export function clearNetworkPerformance(): void {
  entries.length = 0;
}

export function recordRelayPerformance(
  origin: string,
  relayPhase: NonNullable<NetworkPerformanceEntry["relayPhase"]>,
  totalMs: number,
  outcome: NetworkOutcome = "success"
): void {
  recordNetworkPerformance({
    origin,
    source: "nostr",
    relayPhase,
    totalMs: Math.max(0, totalMs),
    outcome
  });
}

export function recordTransportRecovery(platform: "android" | "ios" | "desktop"): void {
  recordNetworkPerformance({
    origin: `${platform}:tor`,
    source: "manual",
    totalMs: 0,
    outcome: "network-error"
  });
}

function hashOrigin(origin: string): string {
  let hash = 0x811c9dc5;
  const value = `${salt}|${origin}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function randomSalt(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

if (typeof window !== "undefined" && import.meta.env.DEV) {
  Object.defineProperty(window, "__robosatsNetworkPerformance", {
    configurable: true,
    value: networkPerformanceSnapshot
  });
}
