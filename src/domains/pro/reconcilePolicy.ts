import type { ReconcileReason } from "@/domains/pro/pro.types";

export const PRO_RECONCILE_POLICY = {
  maxRobotRequests: 3,
  maxOrderRequests: 2,
  activeMinMs: 30_000,
  activeMaxMs: 60_000,
  waitingMinMs: 60_000,
  waitingMaxMs: 120_000,
  idleMinMs: 180_000,
  idleMaxMs: 300_000,
  fullDiscoveryMinMs: 1_800_000,
  statusFreshMs: 300_000,
  statusStaleMs: 900_000
} as const;

export function canBypassCadence(reason: ReconcileReason): boolean {
  return reason === "fleet-ready"
    || reason === "manual"
    || reason === "nostr-hint"
    || reason === "online"
    || reason === "order-action"
    || reason === "tor-ready"
    || reason === "tor-reconnected";
}

export function jitteredDelay(minimum: number, maximum: number, random = Math.random): number {
  if (maximum <= minimum) return minimum;
  return Math.floor(minimum + random() * (maximum - minimum + 1));
}

export function shouldRefreshRobotStatus(lastSuccessAt?: number, now = Date.now()): boolean {
  return !lastSuccessAt || now - lastSuccessAt >= PRO_RECONCILE_POLICY.statusFreshMs;
}

export function isRobotStatusStale(lastSuccessAt?: number, now = Date.now()): boolean {
  return Boolean(lastSuccessAt && now - lastSuccessAt >= PRO_RECONCILE_POLICY.statusStaleMs);
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const width = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return results;
}
