import type { CoordinatorConnection, Network, Origin } from "@/domains/coordinators/coordinator.types";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { systemClient } from "@/domains/transport/systemClient";

export const ORDERBOOK_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
export const ORDERBOOK_CACHE_STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ORDERBOOK_CACHE_KEY = "robosats_exp_orderbook_cache_v1";

export interface CachedOrderbook {
  savedAt: number;
  connection: CoordinatorConnection;
  network: Network;
  origin: Origin;
  orders: PublicOrder[];
}

export function readOrderbookCache(connection: CoordinatorConnection, network: Network, origin: Origin, now = Date.now()): CachedOrderbook | null {
  return readCache(connection, network, origin, ORDERBOOK_CACHE_MAX_AGE_MS, now);
}

export function readStaleOrderbookCache(connection: CoordinatorConnection, network: Network, origin: Origin, now = Date.now()): CachedOrderbook | null {
  return readCache(connection, network, origin, ORDERBOOK_CACHE_STALE_MAX_AGE_MS, now);
}

function readCache(
  connection: CoordinatorConnection,
  network: Network,
  origin: Origin,
  maxAgeMs: number,
  now: number
): CachedOrderbook | null {
  try {
    const nativeRaw = systemClient.getItem(ORDERBOOK_CACHE_KEY);
    const raw = nativeRaw ?? readLegacyCache();
    if (!raw) return null;

    const cached = JSON.parse(raw) as Partial<CachedOrderbook>;
    if (cached.connection !== connection || cached.network !== network || cached.origin !== origin) return null;
    if (!Array.isArray(cached.orders) || typeof cached.savedAt !== "number") return null;
    if (!Number.isFinite(cached.savedAt) || now - cached.savedAt > maxAgeMs) return null;

    if (nativeRaw === null) {
      systemClient.setItem(ORDERBOOK_CACHE_KEY, raw);
    }

    return cached as CachedOrderbook;
  } catch {
    return null;
  }
}

export function writeOrderbookCache(connection: CoordinatorConnection, network: Network, origin: Origin, orders: PublicOrder[], now = Date.now()): void {
  try {
    const cached: CachedOrderbook = {
      savedAt: now,
      connection,
      network,
      origin,
      orders
    };
    systemClient.setItem(ORDERBOOK_CACHE_KEY, JSON.stringify(cached));
  } catch {
    // Cache is best-effort; private browsing and storage quota errors should not affect trading.
  }
}

export function isFreshOrderbookCache(savedAt: number, now = Date.now()): boolean {
  return Number.isFinite(savedAt) && now - savedAt <= ORDERBOOK_CACHE_MAX_AGE_MS;
}

export function clearOrderbookCache(): void {
  try {
    systemClient.deleteItem(ORDERBOOK_CACHE_KEY);
    globalThis.localStorage?.removeItem(ORDERBOOK_CACHE_KEY);
  } catch {
    // Best-effort cleanup.
  }
}

function readLegacyCache(): string | null {
  try {
    return globalThis.localStorage?.getItem(ORDERBOOK_CACHE_KEY) ?? null;
  } catch {
    return null;
  }
}
