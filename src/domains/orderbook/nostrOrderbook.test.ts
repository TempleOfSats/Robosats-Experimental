import { describe, expect, it, vi } from "vitest";
import type { Event } from "nostr-tools";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";

const poolState = vi.hoisted(() => ({
  subscriptions: [] as Array<{
    relays: string[];
    params: { onevent?: (event: Event) => void; oneose?: () => void; onclose?: () => void };
  }>
}));

vi.mock("nostr-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-tools")>();
  return { ...actual, verifyEvent: () => true };
});

vi.mock("nostr-tools/pool", () => {
  class TestSimplePool {
    subscribeMany(
      relays: string[],
      _filter: unknown,
      params: { onevent?: (event: Event) => void; oneose?: () => void; onclose?: () => void }
    ) {
      poolState.subscriptions.push({ relays, params });
      return { close: () => Promise.resolve() };
    }

    destroy() {}
  }

  return { SimplePool: TestSimplePool };
});

import {
  buildNostrRelayUrl,
  fetchNostrOrderbook,
  nostrEventToPublicOrder,
  nostrEventsToPublicOrders,
  resetNostrOrderbookSession,
  selectNostrRelays,
  subscribeNostrOrderbook
} from "@/domains/orderbook/nostrOrderbook";

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
      coordinatorShortAlias: "lake"
    });
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

  it("finishes the initial fetch when the host relay completes both EOSE streams", async () => {
    poolState.subscriptions.length = 0;
    const updates: Array<{ partial: boolean }> = [];
    const promise = fetchNostrOrderbook([coordinator], "mainnet", {
      hostUrl: "unsafe.thebiglake.org",
      maxWaitMs: 20_000,
      onOrders: (_orders, meta) => updates.push(meta)
    });

    expect(poolState.subscriptions).toHaveLength(2);
    expect(poolState.subscriptions.every((subscription) => subscription.relays[0] === "wss://unsafe.thebiglake.org/relay/")).toBe(true);

    poolState.subscriptions.forEach((subscription) => subscription.params.oneose?.());

    await expect(promise).resolves.toEqual([]);
    expect(updates.at(-1)).toEqual({ partial: false, authoritative: true });
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

    expect(poolState.subscriptions).toHaveLength(2);
    poolState.subscriptions.slice(0, 2).forEach((subscription) => subscription.params.oneose?.());
    expect(poolState.subscriptions).toHaveLength(4);

    let settled = false;
    void promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    poolState.subscriptions.slice(2, 4).forEach((subscription) => subscription.params.oneose?.());
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
      expect(poolState.subscriptions).toHaveLength(2);

      poolState.subscriptions[0].params.onevent?.(event({ tags: baseTags({ status: "pending" }) }));
      await vi.advanceTimersByTimeAsync(350);
      poolState.subscriptions.slice(0, 2).forEach((subscription) => subscription.params.oneose?.());
      await expect(promise).resolves.toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1_799);
      expect(poolState.subscriptions).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(poolState.subscriptions).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
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

function baseTags({ status, network = "mainnet" }: { status: string; network?: string }): string[][] {
  return [
    ["d", "order:123"],
    ["s", status],
    ["network", network],
    ["k", "buy"],
    ["fa", "50", "100"],
    ["bond", "3"],
    ["name", "MakerRobot", "maker-hash"],
    ["premium", "1.5"],
    ["pm", "SEPA"],
    ["f", "EUR"],
    ["source", "http://example.onion/order/lake/123"],
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
