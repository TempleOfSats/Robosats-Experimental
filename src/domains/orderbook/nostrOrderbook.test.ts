import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "nostr-tools";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";

const poolState = vi.hoisted(() => ({
  verifyEvent: vi.fn(() => true),
  subscriptions: [] as Array<{
    relays: string[];
    filter: unknown;
    params: { onevent?: (event: Event) => void; oneose?: () => void; onclose?: () => void };
  }>
}));

vi.mock("nostr-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-tools")>();
  return { ...actual, verifyEvent: poolState.verifyEvent };
});

vi.mock("@/domains/nostr/sharedRelayPool", () => ({
  getLiveRelaySubscriptions: () => ({
    subscribeMany(
      relays: string[],
      filter: unknown,
      params: { onevent?: (event: Event) => void; oneose?: () => void; onclose?: () => void }
    ) {
      poolState.subscriptions.push({ filter, relays, params });
      return { close: () => Promise.resolve() };
    }
  }),
  resetLiveRelaySubscriptionsForTests: () => undefined
}));

import {
  buildNostrRelayUrl,
  compactNostrOrderbookEvents,
  fetchNostrOrderbook,
  nostrEventToPublicOrder,
  nostrEventsToPublicOrders,
  relayFallbackTiming,
  resetNostrOrderbookSession,
  resumeNostrOrderbookSession,
  selectNostrRelays,
  subscribeNostrOrderbook,
  suspendNostrOrderbookSession
} from "@/domains/orderbook/nostrOrderbook";
import { noteRelayEose, resetRelayHealthForTests } from "@/domains/nostr/relayHealth";
import { resetLiveRelaySubscriptionsForTests } from "@/domains/nostr/sharedRelayPool";

const coordinator = {
  shortAlias: "lake",
  longAlias: "TheBigLake",
  color: "#000D28",
  url: "https://unsafe.thebiglake.org",
  nostrHexPubkey: "coordinator-pubkey",
  avatarUrl: "",
  smallAvatarUrl: "",
  badgeIcons: [],
  enabled: true,
  online: false
} satisfies CoordinatorSummary;

describe("nostr orderbook", () => {
  beforeEach(() => {
    resetNostrOrderbookSession();
    resetLiveRelaySubscriptionsForTests();
    resetRelayHealthForTests();
    poolState.verifyEvent.mockClear();
    poolState.subscriptions.length = 0;
  });

  it("converts current RoboSats kind 38383 order tags into public offers", () => {
    const parsed = nostrEventToPublicOrder(
      event({
        tags: [
          ["d", "order:89895"],
          ["s", "pending"],
          ["network", "mainnet"],
          ["k", "sell"],
          ["expiration", "1783425600", "86400"],
          ["fa", "1360"],
          ["bond", "3"],
          ["name", "HelpfulVeranda735", "maker-hash"],
          ["premium", "0"],
          ["pm", "PIX", "Revolut"],
          ["g", "xn774"],
          ["f", "BRL"],
          ["source", "http://example.onion/order/lake/89895"],
          ["y", "robosats", "lake"]
        ]
      }),
      [coordinator],
      "mainnet"
    );

    expect(parsed.publicOrder).toMatchObject({
      id: 89895,
      created_at: "1970-01-01T00:00:01.000Z",
      expires_at: "2026-07-07T12:00:00.000Z",
      type: 1,
      currency: 20,
      currencyCode: "BRL",
      amount: 1360,
      has_range: false,
      payment_method: "PIX Revolut",
      maker_nick: "HelpfulVeranda735",
      maker_hash_id: "maker-hash",
      bond_size_percent: 3,
      latitude: expect.any(Number),
      longitude: expect.any(Number),
      coordinatorShortAlias: "lake"
    });
    expect(parsed.publicOrder?.latitude).toBeCloseTo(35.7, 0);
    expect(parsed.publicOrder?.longitude).toBeCloseTo(139.7, 0);
  });

  it("removes an offer when a newer event for the same d tag is not pending", () => {
    const pending = event({
      created_at: 10,
      tags: baseTags({ status: "pending" })
    });
    const canceled = event({
      created_at: 11,
      tags: baseTags({ status: "canceled" })
    });

    expect(nostrEventsToPublicOrders([canceled, pending], [coordinator], "mainnet")).toEqual([]);
  });

  it("does not let another network tombstone remove the selected network offer", () => {
    const pending = event({
      created_at: 10,
      tags: baseTags({ status: "pending", network: "mainnet" })
    });
    const testnetCanceled = event({
      created_at: 11,
      tags: baseTags({ status: "canceled", network: "testnet" })
    });

    expect(nostrEventsToPublicOrders([testnetCanceled, pending], [coordinator], "mainnet")).toHaveLength(1);
  });

  it("compacts retained events to the latest update for each order and network", () => {
    const pending = event({
      created_at: 10,
      id: "pending",
      tags: baseTags({ status: "pending", network: "mainnet" })
    });
    const canceled = event({
      created_at: 11,
      id: "canceled",
      tags: baseTags({ status: "canceled", network: "mainnet" })
    });
    const testnet = event({
      created_at: 12,
      id: "testnet",
      tags: baseTags({ status: "pending", network: "testnet" })
    });

    expect(compactNostrOrderbookEvents([pending, canceled, testnet], 20, 10).map((item) => item.id)).toEqual([
      "testnet",
      "canceled"
    ]);
  });

  it("drops stale retained events and keeps the newest entries within its cap", () => {
    const now = 200_000;
    const fresh = Array.from({ length: 5 }, (_, index) =>
      event({
        created_at: now - index,
        id: `fresh-${index}`,
        tags: baseTags({ orderId: 90_000 + index })
      })
    );
    const stale = event({
      created_at: now - 30 * 60 * 60 - 1,
      id: "stale",
      tags: baseTags({ orderId: 80_000 })
    });

    expect(compactNostrOrderbookEvents([...fresh, stale], now, 3).map((item) => item.id)).toEqual([
      "fresh-0",
      "fresh-1",
      "fresh-2"
    ]);
  });

  it("does not let unusable events crowd a valid order out of retained state", () => {
    const valid = event({
      created_at: 10,
      id: "valid",
      tags: baseTags({ status: "pending" })
    });
    const unusable = Array.from({ length: 5 }, (_, index) =>
      event({
        created_at: 20 + index,
        id: `missing-d-${index}`,
        tags: [["network", "mainnet"]]
      })
    );

    expect(compactNostrOrderbookEvents([valid, ...unusable], 30, 1).map((item) => item.id)).toEqual(["valid"]);
  });

  it("derives the relay URL from the selected coordinator URL", () => {
    expect(buildNostrRelayUrl(coordinator)).toBe("wss://unsafe.thebiglake.org/relay/");
    expect(buildNostrRelayUrl({ url: "http://example.onion/base" })).toBe("ws://example.onion/base/relay/");
  });

  it("prefers the current host relay and limits relay fanout like the current frontend", () => {
    const relays = selectNostrRelays(
      [
        { url: "https://alpha.example" },
        { url: "https://unsafe.thebiglake.org" },
        { url: "https://bravo.example" },
        { url: "https://charlie.example" }
      ],
      "unsafe.thebiglake.org"
    );

    expect(relays).toHaveLength(3);
    expect(relays[0]).toBe("wss://unsafe.thebiglake.org/relay/");
    expect(new Set(relays).size).toBe(3);
  });

  it("keeps the selected relay set stable across refresh and live subscribers", () => {
    const coordinators = [
      { url: "https://alpha.example" },
      { url: "https://bravo.example" },
      { url: "https://charlie.example" },
      { url: "https://delta.example" }
    ];

    expect(selectNostrRelays(coordinators)).toEqual(selectNostrRelays(coordinators));
  });

  it("does not verify the same relay event more than once", () => {
    const unsubscribe = subscribeNostrOrderbook([coordinator], "mainnet");
    const pending = event({ tags: baseTags({ status: "pending" }) });

    poolState.subscriptions[0].params.onevent?.(pending);
    poolState.subscriptions[0].params.onevent?.(pending);

    expect(poolState.verifyEvent).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("prefers relays whose coordinators are already known online", () => {
    const relays = selectNostrRelays(
      [
        { url: "https://offline.example", online: false },
        { url: "https://alpha.example", online: true },
        { url: "https://bravo.example", online: true },
        { url: "https://charlie.example", online: true }
      ],
      "",
      3
    );

    expect(relays).toHaveLength(3);
    expect(relays).not.toContain("wss://offline.example/relay/");
  });

  it("fails over a closed live relay and deprioritizes it on reconnect", () => {
    poolState.subscriptions.length = 0;
    const coordinators = [
      coordinator,
      { ...coordinator, shortAlias: "temple", url: "https://temple.example", nostrHexPubkey: "temple-key" },
      { ...coordinator, shortAlias: "alice", url: "https://alice.example", nostrHexPubkey: "alice-key" }
    ] satisfies CoordinatorSummary[];

    const unsubscribe = subscribeNostrOrderbook(coordinators, "mainnet");
    const failedRelay = poolState.subscriptions[0].relays[0];
    poolState.subscriptions[0].params.onclose?.();

    expect(new Set(poolState.subscriptions.map((subscription) => subscription.relays[0])).size).toBeGreaterThan(1);
    resetNostrOrderbookSession();
    unsubscribe();
    expect(selectNostrRelays(coordinators)[0]).not.toBe(failedRelay);
  });

  it("backs off reconnecting the same failed relay", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    poolState.subscriptions.length = 0;

    try {
      const unsubscribe = subscribeNostrOrderbook([coordinator], "mainnet");
      expect(poolState.subscriptions).toHaveLength(1);

      poolState.subscriptions[0].params.onclose?.();
      await vi.advanceTimersByTimeAsync(14_999);
      expect(poolState.subscriptions).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(poolState.subscriptions).toHaveLength(2);

      poolState.subscriptions[1].params.onclose?.();
      await vi.advanceTimersByTimeAsync(44_999);
      expect(poolState.subscriptions).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(poolState.subscriptions).toHaveLength(3);

      resetNostrOrderbookSession();
      unsubscribe();
    } finally {
      resetNostrOrderbookSession();
      vi.useRealTimers();
    }
  });

  it("sequences the host snapshot and live streams before finishing the initial fetch", async () => {
    poolState.subscriptions.length = 0;
    const updates: Array<{ partial: boolean }> = [];
    const promise = fetchNostrOrderbook([coordinator], "mainnet", {
      hostUrl: "unsafe.thebiglake.org",
      maxWaitMs: 20_000,
      onOrders: (_orders, meta) => updates.push(meta)
    });

    expect(poolState.subscriptions).toHaveLength(1);
    poolState.subscriptions[0].params.oneose?.();
    await vi.waitFor(() => expect(poolState.subscriptions).toHaveLength(2));
    expect(
      poolState.subscriptions.every((subscription) => subscription.relays[0] === "wss://unsafe.thebiglake.org/relay/")
    ).toBe(true);
    poolState.subscriptions[1].params.oneose?.();

    await expect(promise).resolves.toEqual([]);
    expect(updates.at(-1)).toEqual({ partial: false, authoritative: true });
  });

  it("bounds the initial snapshot while including terminal events published before the live stream", async () => {
    poolState.subscriptions.length = 0;
    const promise = fetchNostrOrderbook([coordinator], "mainnet", {
      hostUrl: "unsafe.thebiglake.org",
      maxWaitMs: 20_000,
      nowSeconds: 200_000
    });

    expect(poolState.subscriptions[0].filter).toEqual({
      authors: ["coordinator-pubkey"],
      kinds: [38383],
      since: 92_000,
      until: 200_000
    });
    poolState.subscriptions[0].params.onevent?.(
      event({
        id: "pending-event",
        created_at: 199_000,
        tags: baseTags({ status: "pending" })
      })
    );
    poolState.subscriptions[0].params.onevent?.(
      event({
        id: "terminal-event",
        created_at: 199_001,
        tags: baseTags({ status: "success" })
      })
    );
    poolState.subscriptions[0].params.oneose?.();

    await vi.waitFor(() => expect(poolState.subscriptions).toHaveLength(2));
    expect(poolState.subscriptions[1].filter).toEqual({
      authors: ["coordinator-pubkey"],
      kinds: [38383],
      "#s": ["pending", "success", "canceled", "in-progress"],
      since: 200_000
    });
    poolState.subscriptions[1].params.oneose?.();

    await expect(promise).resolves.toEqual([]);
  });

  it("checks a fallback relay before accepting an empty multi-relay orderbook", async () => {
    poolState.subscriptions.length = 0;
    const secondCoordinator = {
      ...coordinator,
      shortAlias: "temple",
      longAlias: "Temple of Sats",
      url: "https://temple.example",
      nostrHexPubkey: "second-coordinator-pubkey"
    } satisfies CoordinatorSummary;
    const promise = fetchNostrOrderbook([coordinator, secondCoordinator], "testnet", {
      hostUrl: "unsafe.thebiglake.org",
      maxWaitMs: 20_000
    });

    expect(poolState.subscriptions).toHaveLength(1);
    poolState.subscriptions[0].params.oneose?.();
    await vi.waitFor(() => expect(poolState.subscriptions).toHaveLength(2));
    poolState.subscriptions[1].params.oneose?.();
    await vi.waitFor(() => expect(poolState.subscriptions).toHaveLength(3));

    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    poolState.subscriptions[2].params.oneose?.();
    await vi.waitFor(() => expect(poolState.subscriptions).toHaveLength(4));
    poolState.subscriptions[3].params.oneose?.();
    await expect(promise).resolves.toEqual([]);
  });

  it("marks a deadline result as partial when no relay completed", async () => {
    vi.useFakeTimers();
    poolState.subscriptions.length = 0;
    const updates: Array<{ partial: boolean; authoritative: boolean }> = [];
    const timeoutCoordinator = {
      ...coordinator,
      shortAlias: "timeout",
      url: "https://timeout.example",
      nostrHexPubkey: "timeout-coordinator-pubkey"
    } satisfies CoordinatorSummary;

    try {
      const promise = fetchNostrOrderbook([timeoutCoordinator], "mainnet", {
        maxWaitMs: 50,
        onOrders: (_orders, meta) => updates.push(meta)
      });
      await vi.advanceTimersByTimeAsync(50);

      await expect(promise).resolves.toEqual([]);
      expect(updates.at(-1)).toEqual({ partial: true, authoritative: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles an unfinished fetch when its session is reset", async () => {
    poolState.subscriptions.length = 0;
    const promise = fetchNostrOrderbook([coordinator], "mainnet", {
      maxWaitMs: 20_000
    });

    resetNostrOrderbookSession();

    await expect(promise).resolves.toEqual([]);
  });

  it("cancels relay fallback and reconnect timers when its session is reset", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    poolState.subscriptions.length = 0;

    try {
      const promise = fetchNostrOrderbook([coordinator], "mainnet", {
        maxWaitMs: 45_000
      });
      expect(poolState.subscriptions).toHaveLength(1);
      poolState.subscriptions[0].params.onclose?.();

      resetNostrOrderbookSession();
      await expect(promise).resolves.toEqual([]);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(poolState.subscriptions).toHaveLength(1);
    } finally {
      resetNostrOrderbookSession();
      vi.useRealTimers();
    }
  });

  it("does not create relay work while suspended and starts cleanly after resume", async () => {
    vi.useFakeTimers();
    poolState.subscriptions.length = 0;

    try {
      const activeFetch = fetchNostrOrderbook([coordinator], "mainnet", { maxWaitMs: 45_000 });
      expect(poolState.subscriptions).toHaveLength(1);
      suspendNostrOrderbookSession();
      await expect(activeFetch).rejects.toMatchObject({ name: "AbortError" });
      await expect(fetchNostrOrderbook([coordinator], "mainnet")).rejects.toMatchObject({
        name: "AbortError"
      });
      const unsubscribe = subscribeNostrOrderbook([coordinator], "mainnet");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(poolState.subscriptions).toHaveLength(1);
      unsubscribe();

      resumeNostrOrderbookSession();
      const promise = fetchNostrOrderbook([coordinator], "mainnet", { maxWaitMs: 20_000 });
      expect(poolState.subscriptions).toHaveLength(2);
      resetNostrOrderbookSession();
      await expect(promise).resolves.toEqual([]);
    } finally {
      resumeNostrOrderbookSession();
      resetNostrOrderbookSession();
      vi.useRealTimers();
    }
  });

  it("starts one delayed reconciliation relay after a fast non-host snapshot", async () => {
    vi.useFakeTimers();
    poolState.subscriptions.length = 0;
    const secondCoordinator = {
      ...coordinator,
      shortAlias: "reconcile",
      url: "https://reconcile.example",
      nostrHexPubkey: "reconcile-coordinator-pubkey"
    } satisfies CoordinatorSummary;

    try {
      const promise = fetchNostrOrderbook([coordinator, secondCoordinator], "mainnet", {
        hostUrl: "standalone-client.example",
        maxWaitMs: 20_000
      });
      expect(poolState.subscriptions).toHaveLength(1);

      poolState.subscriptions[0].params.onevent?.(event({ tags: baseTags({ status: "pending" }) }));
      await vi.advanceTimersByTimeAsync(350);
      poolState.subscriptions[0].params.oneose?.();
      await Promise.resolve();
      poolState.subscriptions[1].params.oneose?.();
      await expect(promise).resolves.toHaveLength(1);

      await vi.advanceTimersByTimeAsync(14_999);
      expect(poolState.subscriptions).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(poolState.subscriptions).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tries one safety relay when the first relay emits data but never completes", async () => {
    vi.useFakeTimers();
    poolState.subscriptions.length = 0;
    const secondCoordinator = {
      ...coordinator,
      shortAlias: "safety",
      url: "https://safety.example",
      nostrHexPubkey: "safety-coordinator-pubkey"
    } satisfies CoordinatorSummary;

    try {
      const promise = fetchNostrOrderbook([coordinator, secondCoordinator], "mainnet", {
        maxWaitMs: 45_000
      });
      expect(poolState.subscriptions).toHaveLength(1);
      const responsiveRelay = poolState.subscriptions[0].relays[0];

      poolState.subscriptions[0].params.onevent?.(event({ tags: baseTags({ status: "pending" }) }));
      await vi.advanceTimersByTimeAsync(14_999);
      expect(poolState.subscriptions).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(poolState.subscriptions).toHaveLength(2);

      poolState.subscriptions[1].params.oneose?.();
      await vi.waitFor(() => expect(poolState.subscriptions).toHaveLength(3));
      poolState.subscriptions[2].params.oneose?.();
      await expect(promise).resolves.toHaveLength(1);

      resetNostrOrderbookSession();
      expect(selectNostrRelays([coordinator, secondCoordinator])[0]).toBe(responsiveRelay);
    } finally {
      vi.useRealTimers();
    }
  });

  it("temporarily deprioritizes a relay that stays completely silent until fallback", async () => {
    vi.useFakeTimers();
    poolState.subscriptions.length = 0;
    const secondCoordinator = {
      ...coordinator,
      shortAlias: "fallback",
      url: "https://fallback.example",
      nostrHexPubkey: "fallback-coordinator-pubkey"
    } satisfies CoordinatorSummary;
    const coordinators = [coordinator, secondCoordinator];

    try {
      const unsubscribe = subscribeNostrOrderbook(coordinators, "mainnet", {
        maxWaitMs: 45_000
      });
      const silentRelay = poolState.subscriptions[0].relays[0];

      await vi.advanceTimersByTimeAsync(14_999);
      expect(poolState.subscriptions).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(poolState.subscriptions).toHaveLength(2);

      resetNostrOrderbookSession();
      unsubscribe();
      expect(selectNostrRelays(coordinators)[0]).not.toBe(silentRelay);
    } finally {
      resetNostrOrderbookSession();
      vi.useRealTimers();
    }
  });

  it("adapts speculative relay fanout to observed Tor latency", () => {
    expect(relayFallbackTiming("ws://unknown.onion/relay/")).toEqual({
      primaryMs: 15_000,
      secondaryMs: 30_000
    });

    noteRelayEose("ws://known.onion/relay/", 20_000);
    expect(relayFallbackTiming("ws://known.onion/relay/")).toEqual({
      primaryMs: 30_000,
      secondaryMs: 45_000
    });
  });

  it("does not crash the page while coordinator relay metadata is still loading", () => {
    const updates: Array<{ partial: boolean; authoritative: boolean }> = [];

    const unsubscribe = subscribeNostrOrderbook([], "mainnet", {
      onOrders: (_orders, meta) => updates.push(meta)
    });

    expect(updates).toEqual([{ partial: true, authoritative: false }]);
    expect(() => unsubscribe()).not.toThrow();
  });
});

function baseTags({
  status = "pending",
  network = "mainnet",
  orderId = 123
}: {
  status?: string;
  network?: string;
  orderId?: number;
}): string[][] {
  return [
    ["d", `order:${orderId}`],
    ["s", status],
    ["network", network],
    ["k", "buy"],
    ["fa", "50", "100"],
    ["bond", "3"],
    ["name", "MakerRobot", "maker-hash"],
    ["premium", "1.5"],
    ["pm", "SEPA"],
    ["f", "EUR"],
    ["source", `http://example.onion/order/lake/${orderId}`],
    ["y", "robosats", "lake"]
  ];
}

function event(overrides: Partial<Event>): Event {
  return {
    id: "event-id",
    pubkey: "coordinator-pubkey",
    created_at: 1,
    kind: 38383,
    tags: [],
    content: "",
    sig: "signature",
    ...overrides
  };
}
