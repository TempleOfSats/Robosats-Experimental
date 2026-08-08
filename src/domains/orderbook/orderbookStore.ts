import { create } from "zustand";
import { toUserMessage } from "@/lib/userError";
import { fetchCoordinatorBook } from "@/domains/coordinators/coordinatorApi";
import type { CoordinatorConnection, CoordinatorSummary, Network, Origin } from "@/domains/coordinators/coordinator.types";
import { fetchNostrOrderbook } from "@/domains/orderbook/nostrOrderbook";
import { activePublicOrders } from "@/domains/orderbook/orderbookFilters";
import {
  isFreshOrderbookCache,
  readOrderbookCache,
  readStaleOrderbookCache,
  writeOrderbookCache
} from "@/domains/orderbook/orderbookCache";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

let refreshSequence = 0;
let refreshInFlight: OrderbookRefreshRun | undefined;
const ORDERBOOK_STATE_FRESH_MS = 60 * 1000;
const API_BOOK_CONCURRENCY = 2;

type OrderbookRefreshPriority = "background" | "visible";

interface OrderbookRefreshRun {
  activeApiBookUrls: Set<string>;
  key: string;
  priority: OrderbookRefreshPriority;
  promise: Promise<void>;
}

interface OrderbookRefreshOptions {
  connection?: CoordinatorConnection;
  force?: boolean;
  hostUrl?: string;
  network?: Network;
  origin?: Origin;
  priority?: OrderbookRefreshPriority;
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
    const priority = options.force ? "visible" : options.priority ?? "visible";
    const state = get();
    const sameSource = state.sourceConnection === connection && state.sourceNetwork === network && state.sourceOrigin === origin;

    if (refreshInFlight?.key === refreshKey) {
      if (priority === "visible" && refreshInFlight.priority === "background") {
        refreshInFlight.priority = "visible";
        // The API client deduplicates identical GETs and promotes a queued
        // background request when the visible route asks for the same URL.
        refreshInFlight.activeApiBookUrls.forEach((url) => {
          void fetchCoordinatorBook(url, { priority: "visible" }).catch(() => undefined);
        });
      }
      return refreshInFlight.promise;
    }

    if (!options.force) {
      if (sameSource && state.lastUpdated && Date.now() - state.lastUpdated < ORDERBOOK_STATE_FRESH_MS && !state.error) return;
    }

    const run: OrderbookRefreshRun = {
      activeApiBookUrls: new Set(),
      key: refreshKey,
      priority,
      promise: Promise.resolve()
    };
    run.promise = runOrderbookRefresh(coordinators, options, run, set, get).finally(() => {
      if (refreshInFlight === run) {
        refreshInFlight = undefined;
      }
    });

    refreshInFlight = run;
    return run.promise;
  },
  applyLiveOrders: (orders, connection, network, origin, partial = false) => {
    applyOrderbookSnapshot(set, orders, connection, network, origin, partial);
  }
}));

async function runOrderbookRefresh(
  coordinators: CoordinatorSummary[],
  options: OrderbookRefreshOptions,
  run: OrderbookRefreshRun,
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
  const cachedOrders = cached ? activePublicOrders(cached.orders) : [];
  const cachedState = cached && isFreshOrderbookCache(cached.savedAt) ? "fresh" : "stale";

  set((state) => {
    const sameSource = state.sourceConnection === connection && state.sourceNetwork === network && state.sourceOrigin === origin;

    if (cached && cachedOrders.length > 0 && (!sameSource || state.orders.length === 0)) {
      cachedPaintMs = performance.now() - startedAt;
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
    const targets = prioritizedApiTargets(
      coordinators.filter((coordinator) => coordinator.enabled),
      options.hostUrl
    );
    const enabledAliases = new Set(targets.map((coordinator) => coordinator.shortAlias));
    const results = await mapWithConcurrency(targets, API_BOOK_CONCURRENCY, async (coordinator) => {
      run.activeApiBookUrls.add(coordinator.url);
      try {
        const orders = await fetchCoordinatorBook(coordinator.url, {
          force: options.force,
          priority: run.priority
        });
        const coordinatorOrders = orders.map((order) => ({
          ...order,
          coordinatorShortAlias: coordinator.shortAlias
        }));
        if (sequence === refreshSequence) {
          if (firstPartialMs === undefined) firstPartialMs = performance.now() - startedAt;
          applyApiCoordinatorBook(
            set,
            coordinator.shortAlias,
            coordinatorOrders,
            enabledAliases,
            connection,
            network,
            origin
          );
        }
        return { coordinator, orders: coordinatorOrders };
      } catch (error) {
        return { coordinator, error };
      } finally {
        run.activeApiBookUrls.delete(coordinator.url);
      }
    });

    if (sequence !== refreshSequence) return;
    const successfulBooks = results.filter(
      (result): result is { coordinator: CoordinatorSummary; orders: PublicOrder[] } =>
        "orders" in result
    );
    if (successfulBooks.length === 0) {
      const failure = results.find((result) => "error" in result);
      throw failure?.error ?? new Error("No coordinator orderbook could be loaded");
    }
    const orders = get().orders.filter((order) => enabledAliases.has(order.coordinatorShortAlias));
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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

function prioritizedApiTargets(
  coordinators: CoordinatorSummary[],
  hostUrl = typeof window === "undefined" ? "" : window.location.origin
): CoordinatorSummary[] {
  return coordinators
    .map((coordinator, index) => ({ coordinator, index }))
    .sort((left, right) => {
      const leftHosted = sameOrigin(left.coordinator.url, hostUrl);
      const rightHosted = sameOrigin(right.coordinator.url, hostUrl);
      return Number(rightHosted) - Number(leftHosted)
        || Number(right.coordinator.online) - Number(left.coordinator.online)
        || (right.coordinator.lastCheckedAt ?? 0) - (left.coordinator.lastCheckedAt ?? 0)
        || left.index - right.index;
    })
    .map(({ coordinator }) => coordinator);
}

function sameOrigin(candidate: string, hostUrl: string): boolean {
  if (!candidate || !hostUrl) return false;
  try {
    return new URL(candidate).origin === new URL(hostUrl).origin;
  } catch {
    return false;
  }
}

function applyApiCoordinatorBook(
  set: (partial: Partial<OrderbookState> | ((state: OrderbookState) => Partial<OrderbookState>)) => void,
  shortAlias: string,
  orders: PublicOrder[],
  enabledAliases: Set<string>,
  connection: CoordinatorConnection,
  network: Network,
  origin: Origin
): void {
  set((state) => ({
    orders: mergeOrders(
      state.orders.filter((order) =>
        enabledAliases.has(order.coordinatorShortAlias)
        && order.coordinatorShortAlias !== shortAlias
      ),
      orders
    ),
    loading: false,
    refreshing: true,
    error: undefined,
    sourceConnection: connection,
    sourceNetwork: network,
    sourceOrigin: origin
  }));
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

  if (!import.meta.env.DEV) return;

  console.debug("[orderbook]", timing);
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
