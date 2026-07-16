import { create } from "zustand";
import { toUserMessage } from "@/lib/userError";
import { fetchCoordinatorBook } from "@/domains/coordinators/coordinatorApi";
import type { CoordinatorConnection, CoordinatorSummary, Network, Origin } from "@/domains/coordinators/coordinator.types";
import { fetchNostrOrderbook } from "@/domains/orderbook/nostrOrderbook";
import {
  isFreshOrderbookCache,
  readOrderbookCache,
  readStaleOrderbookCache,
  writeOrderbookCache
} from "@/domains/orderbook/orderbookCache";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

let refreshSequence = 0;
let refreshInFlight: Promise<void> | undefined;
let refreshInFlightKey = "";
const ORDERBOOK_STATE_FRESH_MS = 60 * 1000;

interface OrderbookRefreshOptions {
  connection?: CoordinatorConnection;
  force?: boolean;
  hostUrl?: string;
  network?: Network;
  origin?: Origin;
}

type OrderbookState = {
  orders: PublicOrder[];
  loading: boolean;
  refreshing: boolean;
  cacheState: "none" | "fresh" | "stale";
  error?: string;
  lastUpdated?: number;
  sourceConnection?: CoordinatorConnection;
  sourceNetwork?: Network;
  sourceOrigin?: Origin;
  refreshOrderbook: (coordinators: CoordinatorSummary[], options?: OrderbookRefreshOptions) => Promise<void>;
  applyLiveOrders: (
    orders: PublicOrder[],
    connection: CoordinatorConnection,
    network: Network,
    origin: Origin,
    partial?: boolean
  ) => void;
};

export const useOrderbookStore = create<OrderbookState>((set, get) => ({
  orders: [],
  cacheState: "none",
  loading: false,
  refreshing: false,
  refreshOrderbook: async (coordinators, options = {}) => {
    const connection = options.connection ?? "api";
    const network = options.network ?? "mainnet";
    const origin = options.origin ?? "clearnet";
    const refreshKey = orderbookRefreshKey(coordinators, connection, network, options.hostUrl);
    const state = get();
    const sameSource = state.sourceConnection === connection && state.sourceNetwork === network && state.sourceOrigin === origin;

    if (!options.force) {
      if (refreshInFlight && refreshInFlightKey === refreshKey) return refreshInFlight;
      if (sameSource && state.lastUpdated && Date.now() - state.lastUpdated < ORDERBOOK_STATE_FRESH_MS && !state.error) return;
    }

    const refresh = runOrderbookRefresh(coordinators, options, set, get).finally(() => {
      if (refreshInFlight === refresh) {
        refreshInFlight = undefined;
        refreshInFlightKey = "";
      }
    });

    refreshInFlight = refresh;
    refreshInFlightKey = refreshKey;
    return refresh;
  },
  applyLiveOrders: (orders, connection, network, origin, partial = false) => {
    applyOrderbookSnapshot(set, orders, connection, network, origin, partial);
  }
}));

async function runOrderbookRefresh(
  coordinators: CoordinatorSummary[],
  options: OrderbookRefreshOptions,
  set: (partial: Partial<OrderbookState> | ((state: OrderbookState) => Partial<OrderbookState>)) => void,
  get: () => OrderbookState
): Promise<void> {
  const sequence = ++refreshSequence;
  const connection = options.connection ?? "api";
  const network = options.network ?? "mainnet";
  const origin = options.origin ?? "clearnet";
  const startedAt = performance.now();
  let cachedPaintMs: number | undefined;
  let firstPartialMs: number | undefined;
  const cached = readOrderbookCache(connection, network, origin) ?? readStaleOrderbookCache(connection, network, origin);
  const cachedOrders = cached ? activeCachedOrders(cached.orders) : [];
  const cachedState = cached && isFreshOrderbookCache(cached.savedAt) ? "fresh" : "stale";

  set((state) => {
    const sameSource = state.sourceConnection === connection && state.sourceNetwork === network && state.sourceOrigin === origin;

    if (cached && cachedOrders.length > 0 && (!sameSource || state.orders.length === 0)) {
      cachedPaintMs = performance.now() - startedAt;
      logNativeOrderbook(
        `Rendered ${cachedOrders.length} ${cachedState} cached offers in ${Math.round(cachedPaintMs)}ms`
      );
      return {
        orders: cachedOrders,
        loading: false,
        refreshing: true,
        cacheState: cachedState,
        error: undefined,
        lastUpdated: cached.savedAt,
        sourceConnection: connection,
        sourceNetwork: network,
        sourceOrigin: origin
      };
    }

    return {
      orders: sameSource ? state.orders : [],
      loading: !sameSource || state.orders.length === 0,
      refreshing: sameSource && state.orders.length > 0,
      cacheState: "none",
      error: undefined,
      sourceConnection: connection,
      sourceNetwork: network,
      sourceOrigin: origin
    };
  });

  try {
    if (connection === "nostr") {
      let receivedAuthoritativeSnapshot = false;
      const orders = await fetchNostrOrderbook(coordinators, network, {
        hostUrl: options.hostUrl,
        onOrders: (orders, meta) => {
          if (sequence !== refreshSequence) return;
          if (firstPartialMs === undefined) firstPartialMs = performance.now() - startedAt;
          if (meta.authoritative && !meta.partial) receivedAuthoritativeSnapshot = true;
          applyOrderbookSnapshot(
            set,
            orders,
            connection,
            network,
            origin,
            meta.partial || !meta.authoritative
          );
        }
      });

      if (sequence !== refreshSequence) return;
      if (!receivedAuthoritativeSnapshot) {
        throw new Error("Nostr relays are still reconnecting. Showing the last confirmed offers.");
      }
      writeOrderbookCache(connection, network, origin, orders);
      logOrderbookTiming({
        connection,
        cachedPaintMs,
        finalMs: performance.now() - startedAt,
        firstPartialMs,
        orderCount: orders.length
      });
      set({
        orders,
        loading: false,
        refreshing: false,
        cacheState: "none",
        lastUpdated: Date.now(),
        sourceConnection: connection,
        sourceNetwork: network,
        sourceOrigin: origin
      });
      return;
    }

    // Coordinator status and orderbook endpoints can recover independently,
    // especially across Tor circuit changes. Always try every enabled book;
    // a stale offline badge must not hide a reachable coordinator's offers.
    const targets = coordinators.filter((coordinator) => coordinator.enabled);
    const results = await Promise.allSettled(
      targets.map(async (coordinator) => {
        const orders = await fetchCoordinatorBook(coordinator.url);
        return orders.map((order) => ({
          ...order,
          coordinatorShortAlias: coordinator.shortAlias
        }));
      })
    );

    if (sequence !== refreshSequence) return;
    const successfulBooks = results.flatMap((result, index) => result.status === "fulfilled"
      ? [{ coordinator: targets[index], orders: result.value }]
      : []);
    if (successfulBooks.length === 0) {
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      throw failure?.reason ?? new Error("No coordinator orderbook could be loaded");
    }
    const enabledAliases = new Set(coordinators.filter((coordinator) => coordinator.enabled).map((coordinator) => coordinator.shortAlias));
    const successfulAliases = new Set(successfulBooks.map(({ coordinator }) => coordinator.shortAlias));
    const retainedOrders = get().orders.filter((order) =>
      enabledAliases.has(order.coordinatorShortAlias) && !successfulAliases.has(order.coordinatorShortAlias)
    );
    const orders = mergeOrders(
      retainedOrders,
      successfulBooks.flatMap(({ orders: coordinatorOrders }) => coordinatorOrders)
    );
    writeOrderbookCache(connection, network, origin, orders);
    logOrderbookTiming({
      connection,
      cachedPaintMs,
      finalMs: performance.now() - startedAt,
      orderCount: orders.length
    });
    set({
      orders,
      loading: false,
      refreshing: false,
      cacheState: "none",
      lastUpdated: Date.now(),
      sourceConnection: connection,
      sourceNetwork: network,
      sourceOrigin: origin
    });
  } catch (error) {
    if (sequence !== refreshSequence) return;
    set((state) => ({
      orders: state.orders,
      loading: false,
      refreshing: false,
      cacheState: state.cacheState,
      error: toUserMessage(error, "Could not load public offers.")
    }));
  }
}

function applyOrderbookSnapshot(
  set: (partial: Partial<OrderbookState> | ((state: OrderbookState) => Partial<OrderbookState>)) => void,
  orders: PublicOrder[],
  connection: CoordinatorConnection,
  network: Network,
  origin: Origin,
  partial: boolean
): void {
  if (!partial) writeOrderbookCache(connection, network, origin, orders);

  set((state) => ({
    orders: partial ? mergeOrders(state.orders, orders) : orders,
    loading: false,
    refreshing: partial,
    cacheState: partial ? state.cacheState : "none",
    error: undefined,
    ...(partial ? {} : { lastUpdated: Date.now() }),
    sourceConnection: connection,
    sourceNetwork: network,
    sourceOrigin: origin
  }));
}

function mergeOrders(existing: PublicOrder[], incoming: PublicOrder[]): PublicOrder[] {
  const merged = new Map(existing.map((order) => [orderKey(order), order]));
  incoming.forEach((order) => merged.set(orderKey(order), order));
  return [...merged.values()];
}

function orderKey(order: PublicOrder): string {
  return `${order.coordinatorShortAlias}:${order.id}`;
}

function activeCachedOrders(orders: PublicOrder[], now = Date.now()): PublicOrder[] {
  return orders.filter((order) => {
    if (!order.expires_at) return true;
    const expiresAt = Date.parse(order.expires_at);
    return !Number.isFinite(expiresAt) || expiresAt > now;
  });
}

function logOrderbookTiming({
  connection,
  cachedPaintMs,
  finalMs,
  firstPartialMs,
  orderCount
}: {
  connection: CoordinatorConnection;
  cachedPaintMs?: number;
  finalMs: number;
  firstPartialMs?: number;
  orderCount: number;
}) {
  const timing = {
    connection,
    cachedPaintMs: cachedPaintMs == null ? undefined : Math.round(cachedPaintMs),
    firstPartialMs: firstPartialMs == null ? undefined : Math.round(firstPartialMs),
    finalMs: Math.round(finalMs),
    orderCount
  };

  logNativeOrderbook(
    `Live ${connection} refresh completed with ${orderCount} offers in ${timing.finalMs}ms` +
      (timing.firstPartialMs == null ? "" : `; first relay data ${timing.firstPartialMs}ms`)
  );

  if (!import.meta.env.DEV) return;

  console.debug("[orderbook]", timing);
}

function logNativeOrderbook(message: string): void {
  globalThis.window?.IOSAppRobosats?.clientLog?.(`Orderbook: ${message}`);
}

function orderbookRefreshKey(
  coordinators: CoordinatorSummary[],
  connection: CoordinatorConnection,
  network: Network,
  hostUrl = ""
): string {
  const coordinatorKey = coordinators
    .filter((coordinator) => coordinator.enabled)
    .map((coordinator) => `${coordinator.shortAlias}:${coordinator.online ? "1" : "0"}:${coordinator.url}`)
    .join(",");

  return [connection, network, hostUrl, coordinatorKey].join("|");
}
