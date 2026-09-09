import type { CoordinatorConnection, Network, Origin } from "@/domains/coordinators/coordinator.types";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { systemClient } from "@/domains/transport/systemClient";

export const ORDERBOOK_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
export const ORDERBOOK_CACHE_STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ORDERBOOK_CACHE_KEY = "robosats_exp_orderbook_cache_v1";
const CACHE_RENEWAL_INTERVAL_MS = 60 * 1000;

let lastWrite: {
  context: string;
  orders: string;
  savedAt: number;
} | undefined;

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
    const raw = systemClient.getItem(ORDERBOOK_CACHE_KEY);
    if (!raw) return null;

    const cached = JSON.parse(raw) as Partial<CachedOrderbook>;
    if (cached.connection !== connection || cached.network !== network || cached.origin !== origin) return null;
    if (!Array.isArray(cached.orders) || typeof cached.savedAt !== "number") return null;
    if (!Number.isFinite(cached.savedAt) || now - cached.savedAt > maxAgeMs) return null;

    return cached as CachedOrderbook;
  } catch {
    return null;
  }
}

export function writeOrderbookCache(connection: CoordinatorConnection, network: Network, origin: Origin, orders: PublicOrder[], now = Date.now()): void {
  try {
    const context = `${connection}|${network}|${origin}`;
    const serializedOrders = JSON.stringify(orders);
    if (
      lastWrite?.context === context
      && lastWrite.orders === serializedOrders
      && now >= lastWrite.savedAt
      && now - lastWrite.savedAt < CACHE_RENEWAL_INTERVAL_MS
    ) return;

    const serializedMetadata = JSON.stringify({ savedAt: now, connection, network, origin });
    const serializedCache = `${serializedMetadata.slice(0, -1)},"orders":${serializedOrders}}`;
    systemClient.setItem(ORDERBOOK_CACHE_KEY, serializedCache);
    lastWrite = { context, orders: serializedOrders, savedAt: now };
  } catch {
    // Cache is best-effort; private browsing and storage quota errors should not affect trading.
  }
}

export function isFreshOrderbookCache(savedAt: number, now = Date.now()): boolean {
  return Number.isFinite(savedAt) && now - savedAt <= ORDERBOOK_CACHE_MAX_AGE_MS;
}

export function clearOrderbookCache(): void {
  lastWrite = undefined;
  try {
    systemClient.deleteItem(ORDERBOOK_CACHE_KEY);
  } catch {
    // Best-effort cleanup.
  }
}
