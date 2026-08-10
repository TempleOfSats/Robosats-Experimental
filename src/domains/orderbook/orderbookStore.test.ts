import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

const fetchCoordinatorBook = vi.hoisted(() => vi.fn());
const fetchNostrOrderbook = vi.hoisted(() => vi.fn());

vi.mock("@/domains/coordinators/coordinatorApi", () => ({
  fetchCoordinatorBook
}));
vi.mock("@/domains/orderbook/nostrOrderbook", () => ({
  fetchNostrOrderbook
}));

import { useOrderbookStore } from "@/domains/orderbook/orderbookStore";

describe("orderbook store reliability", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key))
    });
    fetchCoordinatorBook.mockReset();
    fetchNostrOrderbook.mockReset();
    useOrderbookStore.setState({
      orders: [],
      loading: false,
      refreshing: false,
      cacheState: "none",
      error: undefined,
      lastUpdated: undefined,
      sourceConnection: undefined,
      sourceNetwork: undefined,
      sourceOrigin: undefined
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not erase confirmed offers when a live Nostr snapshot is partial", () => {
    const confirmed = order(1, "lake");
    useOrderbookStore.setState({
      orders: [confirmed],
      sourceConnection: "nostr",
      sourceNetwork: "mainnet",
      sourceOrigin: "onion"
    });

    useOrderbookStore.getState().applyLiveOrders([], "nostr", "mainnet", "onion", true);

    expect(useOrderbookStore.getState().orders).toEqual([confirmed]);
    expect(useOrderbookStore.getState().refreshing).toBe(true);

    useOrderbookStore.getState().applyLiveOrders([], "nostr", "mainnet", "onion", false);
    expect(useOrderbookStore.getState().orders).toEqual([]);
  });

  it("persists an authoritative Nostr snapshot once", async () => {
    const lake = coordinator("lake", "https://lake.example");
    const confirmed = order(1, "lake");
    fetchNostrOrderbook.mockImplementation(async (
      _coordinators: unknown,
      _network: unknown,
      options: { onOrders: (orders: PublicOrder[], meta: { authoritative: boolean; partial: boolean }) => void }
    ) => {
      options.onOrders([confirmed], { authoritative: true, partial: false });
      return [confirmed];
    });

    await useOrderbookStore.getState().refreshOrderbook([lake], {
      connection: "nostr",
      force: true,
      network: "mainnet",
      origin: "onion"
    });

    expect(useOrderbookStore.getState().orders).toEqual([confirmed]);
    expect(globalThis.localStorage.getItem).toHaveBeenCalledOnce();
    expect(globalThis.localStorage.setItem).toHaveBeenCalledOnce();
  });

  it("retains an unreachable coordinator's offers when another API refresh succeeds", async () => {
    const lake = coordinator("lake", "https://lake.example");
    const temple = coordinator("temple", "https://temple.example");
    const staleLakeOrder = order(1, "lake");
    const retainedTempleOrder = order(2, "temple");
    const freshLakeOrder = order(3, "lake");
    useOrderbookStore.setState({
      orders: [staleLakeOrder, retainedTempleOrder],
      sourceConnection: "api",
      sourceNetwork: "mainnet",
      sourceOrigin: "onion"
    });
    fetchCoordinatorBook.mockImplementation(async (url: string) => {
      if (url === lake.url) return [freshLakeOrder];
      throw new Error("temporary Tor circuit failure");
    });

    await useOrderbookStore.getState().refreshOrderbook([lake, temple], {
      connection: "api",
      force: true,
      network: "mainnet",
      origin: "onion"
    });

    expect(useOrderbookStore.getState().orders).toEqual(
      expect.arrayContaining([freshLakeOrder, retainedTempleOrder])
    );
    expect(useOrderbookStore.getState().orders).not.toContain(staleLakeOrder);
  });

  it("publishes a healthy coordinator book before an offline request settles", async () => {
    const lake = coordinator("lake", "https://lake.example");
    const temple = coordinator("temple", "https://temple.example");
    const freshLakeOrder = order(3, "lake");
    let rejectTemple: ((reason?: unknown) => void) | undefined;
    fetchCoordinatorBook.mockImplementation((url: string) => {
      if (url === lake.url) return Promise.resolve([freshLakeOrder]);
      return new Promise((_resolve, reject) => {
        rejectTemple = reject;
      });
    });

    const refresh = useOrderbookStore.getState().refreshOrderbook([lake, temple], {
      connection: "api",
      force: true,
      network: "mainnet",
      origin: "onion"
    });

    await vi.waitFor(() => expect(useOrderbookStore.getState().orders).toEqual([freshLakeOrder]));
    expect(useOrderbookStore.getState().loading).toBe(false);
    expect(useOrderbookStore.getState().refreshing).toBe(true);

    rejectTemple?.(new Error("offline"));
    await refresh;

    expect(useOrderbookStore.getState().orders).toEqual([freshLakeOrder]);
    expect(useOrderbookStore.getState().refreshing).toBe(false);
  });

  it("limits Tor orderbook fan-out while still attempting every coordinator", async () => {
    const coordinators = [
      coordinator("lake", "https://lake.example"),
      coordinator("temple", "https://temple.example"),
      coordinator("alice", "https://alice.example"),
      coordinator("bazaar", "https://bazaar.example")
    ];
    const pending = new Map<string, ReturnType<typeof deferred<PublicOrder[]>>>();
    let active = 0;
    let maximumActive = 0;
    fetchCoordinatorBook.mockImplementation((url: string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const request = deferred<PublicOrder[]>();
      pending.set(url, request);
      return request.promise.finally(() => {
        active -= 1;
      });
    });

    const refresh = useOrderbookStore.getState().refreshOrderbook(coordinators, {
      connection: "api",
      force: true,
      network: "mainnet",
      origin: "onion"
    });

    await vi.waitFor(() => expect(fetchCoordinatorBook).toHaveBeenCalledTimes(2));
    pending.get(coordinators[0].url)?.resolve([]);
    await vi.waitFor(() => expect(fetchCoordinatorBook).toHaveBeenCalledTimes(3));
    pending.get(coordinators[1].url)?.resolve([]);
    await vi.waitFor(() => expect(fetchCoordinatorBook).toHaveBeenCalledTimes(4));
    pending.get(coordinators[2].url)?.resolve([]);
    pending.get(coordinators[3].url)?.resolve([]);
    await refresh;

    expect(maximumActive).toBe(2);
    expect(fetchCoordinatorBook.mock.calls.map(([url]) => url)).toEqual(
      coordinators.map((item) => item.url)
    );
  });

  it("starts the hosted and recently healthy coordinator books first", async () => {
    const staleOnline = coordinator("stale", "https://stale.example", {
      lastCheckedAt: 100,
      online: true
    });
    const offline = coordinator("offline", "https://offline.example", {
      lastCheckedAt: 300,
      online: false
    });
    const recentOnline = coordinator("recent", "https://recent.example", {
      lastCheckedAt: 200,
      online: true
    });
    const hosted = coordinator("hosted", "https://app.example", {
      lastCheckedAt: 50,
      online: false
    });
    const firstRequests: string[] = [];
    const pending = new Map<string, ReturnType<typeof deferred<PublicOrder[]>>>();
    fetchCoordinatorBook.mockImplementation((url: string) => {
      firstRequests.push(url);
      const request = deferred<PublicOrder[]>();
      pending.set(url, request);
      return request.promise;
    });

    const refresh = useOrderbookStore.getState().refreshOrderbook(
      [staleOnline, offline, recentOnline, hosted],
      {
        connection: "api",
        force: true,
        hostUrl: "https://app.example",
        network: "mainnet",
        origin: "onion"
      }
    );

    await vi.waitFor(() => expect(firstRequests).toHaveLength(2));
    expect(firstRequests).toEqual([hosted.url, recentOnline.url]);
    pending.get(hosted.url)?.resolve([]);
    await vi.waitFor(() => expect(firstRequests).toHaveLength(3));
    pending.get(recentOnline.url)?.resolve([]);
    await vi.waitFor(() => expect(firstRequests).toHaveLength(4));
    pending.get(staleOnline.url)?.resolve([]);
    pending.get(offline.url)?.resolve([]);
    await refresh;
  });

  it("uses background book requests until a visible route promotes the refresh", async () => {
    const lake = coordinator("lake", "https://lake.example");
    const temple = coordinator("temple", "https://temple.example");
    const alice = coordinator("alice", "https://alice.example");
    const initialRequests = new Map<string, ReturnType<typeof deferred<PublicOrder[]>>>();
    fetchCoordinatorBook.mockImplementation((url: string, options: { priority?: string }) => {
      if (options.priority === "visible") return Promise.resolve([]);
      const request = deferred<PublicOrder[]>();
      initialRequests.set(url, request);
      return request.promise;
    });

    const background = useOrderbookStore.getState().refreshOrderbook([lake, temple, alice], {
      connection: "api",
      network: "mainnet",
      origin: "onion",
      priority: "background"
    });
    await vi.waitFor(() => expect(fetchCoordinatorBook).toHaveBeenCalledTimes(2));

    const visible = useOrderbookStore.getState().refreshOrderbook([lake, temple, alice], {
      connection: "api",
      network: "mainnet",
      origin: "onion",
      priority: "visible"
    });
    await vi.waitFor(() => {
      expect(fetchCoordinatorBook).toHaveBeenCalledWith(lake.url, { priority: "visible" });
      expect(fetchCoordinatorBook).toHaveBeenCalledWith(temple.url, { priority: "visible" });
    });

    initialRequests.get(lake.url)?.resolve([]);
    initialRequests.get(temple.url)?.resolve([]);
    await Promise.all([background, visible]);

    expect(fetchCoordinatorBook).toHaveBeenCalledWith(alice.url, {
      force: undefined,
      priority: "visible"
    });
  });
});

function coordinator(
  shortAlias: string,
  url: string,
  overrides: Partial<CoordinatorSummary> = {}
): CoordinatorSummary {
  return {
    shortAlias,
    longAlias: shortAlias,
    color: "#111111",
    url,
    avatarUrl: "",
    smallAvatarUrl: "",
    badgeIcons: [],
    enabled: true,
    online: true,
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function order(id: number, coordinatorShortAlias: string): PublicOrder {
  return {
    id,
    type: 0,
    currency: 1,
    currencyCode: "USD",
    amount: 100,
    has_range: false,
    is_swap: false,
    min_amount: 100,
    max_amount: 100,
    payment_method: "Zelle",
    premium: 0,
    satoshis: 10_000,
    maker_nick: "MakerRobot",
    maker_hash_id: `maker-${id}`,
    bond_size_sats: 300,
    coordinatorShortAlias
  };
}
