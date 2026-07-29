import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { apiRoutes } from "@/domains/transport/apiClient";
import { apiClient } from "@/domains/transport/apiWebClient";
import {
  normalizeHistoricalPayload,
  normalizeTicksPayload,
  type CompletedVolumeRecord,
  type MarketTick
} from "@/domains/statistics/statisticsModel";

const CACHE_LIFETIME_MS = 10 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

export async function fetchCompletedVolume(
  coordinator: CoordinatorSummary,
  force = false
): Promise<CompletedVolumeRecord[]> {
  const payload = await cachedGet(coordinator.url, apiRoutes.historical, force);
  return normalizeHistoricalPayload(payload, coordinator.shortAlias);
}

export async function fetchMarketTicks(
  coordinator: CoordinatorSummary,
  start: Date,
  end: Date,
  force = false
): Promise<MarketTick[]> {
  const path = apiRoutes.ticks(formatApiDate(start), formatApiDate(end));
  const payload = await cachedGet(coordinator.url, path, force);
  return normalizeTicksPayload(payload, coordinator.shortAlias);
}

async function cachedGet(baseUrl: string, path: string, force: boolean): Promise<unknown> {
  const key = `${baseUrl}${path}`;
  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await apiClient.get<unknown>(baseUrl, path, undefined, {
    bypassCircuit: force,
    timeoutProfile: "interactive",
    priority: "visible",
    source: "statistics"
  });
  cache.set(key, { expiresAt: Date.now() + CACHE_LIFETIME_MS, value });
  return value;
}

function formatApiDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getUTCFullYear()}`;
}
