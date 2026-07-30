import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type {
  RefreshRobotSlotOptions,
  RefreshRobotSlotResult,
  RobotSlot
} from "@/domains/garage/garageStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import { getRobotOrderAvailability } from "@/domains/garage/robotAvailability";
import type { OrderDto } from "@/domains/orders/order.types";
import {
  GarageReconciler,
  markProOrderActionFinished,
  markProOrderActionStarted
} from "@/domains/pro/garageReconciler";
import { useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import type { ProTradeLocator, ProTradeSnapshot } from "@/domains/pro/pro.types";

const coordinator = {
  shortAlias: "lake",
  longAlias: "TheBigLake",
  color: "#000000",
  url: "https://coordinator.example",
  avatarUrl: "/lake.webp",
  smallAvatarUrl: "/lake.small.webp",
  badgeIcons: [],
  nostrHexPubkey: "coordinator-pubkey",
  enabled: true,
  online: true
} satisfies CoordinatorSummary;

const alpha = makeSlot("alpha", "slot-alpha", "Alpha");
const beta = makeSlot("beta", "slot-beta", "Beta");

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  useGarageStore.setState({ slots: [alpha, beta], currentToken: "alpha", hydrated: true });
  useProTradeIndexStore.getState().resetRuntimeCache();
});

afterEach(() => vi.unstubAllGlobals());

describe("GarageReconciler", () => {
  it("indexes an explicit robot trade without storing its token or changing selection", async () => {
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => robotResult(91234),
      fetchOrder: async () => order({ id: 91234, status: 9 })
    });

    await reconciler.reconcileSlot("slot-beta", "manual");

    const snapshot = useProTradeIndexStore.getState().snapshots["slot-beta:lake:91234"];
    expect(snapshot).toMatchObject({ nickname: "Beta", freshness: "fresh", activeOrderId: 91234 });
    expect(JSON.stringify(snapshot)).not.toContain('"token"');
    expect(useGarageStore.getState().currentToken).toBe("alpha");
  });

  it("backfills an unarchived terminal trade from the locally retained last order id", async () => {
    const completedBeta = {
      ...beta,
      lastOrderId: 91234,
      robots: {
        lake: { ...beta.robots.lake, lastOrderId: 91234 }
      }
    };
    useGarageStore.setState({ slots: [alpha, completedBeta], currentToken: "alpha", hydrated: true });
    const archiveTrade = vi.fn(() => "archived" as const);
    useGarageVaultStore.setState({ archiveTrade });
    const fetchOrder = vi.fn(async () => order({
      id: 91234,
      status: 14,
      is_buyer: true,
      is_seller: false
    }));
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => ({
        slotId: "slot-beta",
        coordinators: [{ shortAlias: "lake", found: true }]
      }),
      fetchOrder
    });

    await reconciler.reconcileSlot("slot-beta", "manual");

    expect(fetchOrder).toHaveBeenCalledWith(
      coordinator,
      91234,
      expect.objectContaining({ tokenSHA256: "slot-beta" }),
      "manual"
    );
    expect(archiveTrade).toHaveBeenCalledWith(expect.objectContaining({
      slotId: "slot-beta",
      coordinatorShortAlias: "lake",
      order: expect.objectContaining({ id: 91234, status: 14 })
    }));
    expect(useProTradeIndexStore.getState().snapshots["slot-beta:lake:91234"]).toBeUndefined();
  });

  it("reserves a restored robot while resolving its last order and restores an expired maker as renewable", async () => {
    let resolveOrder: ((value: OrderDto) => void) | undefined;
    const fetchOrder = vi.fn(() => new Promise<OrderDto>((resolve) => {
      resolveOrder = resolve;
    }));
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => ({
        slotId: "slot-beta",
        coordinators: [{ shortAlias: "lake", found: true, lastOrderId: 91234 }]
      }),
      fetchOrder
    });

    const refresh = reconciler.reconcileSlot("slot-beta", "fleet-ready");
    await vi.waitFor(() => expect(fetchOrder).toHaveBeenCalledOnce());

    const pending = useProTradeIndexStore.getState().snapshots["slot-beta:lake:91234"];
    expect(pending).toMatchObject({
      freshness: "refreshing",
      lastOrderId: 91234
    });
    expect(pending?.order).toBeUndefined();
    expect(getRobotOrderAvailability(
      beta,
      useProTradeIndexStore.getState().snapshots
    ).available).toBe(false);

    resolveOrder?.(order({
      id: 91234,
      status: 5,
      is_maker: true,
      is_taker: false
    }));
    await refresh;

    expect(useProTradeIndexStore.getState().snapshots["slot-beta:lake:91234"]).toMatchObject({
      freshness: "fresh",
      renewable: true,
      order: { id: 91234, status: 5 }
    });
    const restored = useGarageStore.getState().slots.find((slot) => slot.tokenSHA256 === "slot-beta");
    expect(restored?.robots.lake)
      .toMatchObject({ activeOrderId: 91234, lastOrderId: 91234, renewableOrderId: 91234 });
    expect(getRobotOrderAvailability(
      restored,
      useProTradeIndexStore.getState().snapshots
    ).available).toBe(true);
  });

  it("keeps a restored robot reserved when its reported last order cannot be read", async () => {
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => ({
        slotId: "slot-beta",
        coordinators: [{ shortAlias: "lake", found: true, lastOrderId: 91234 }]
      }),
      fetchOrder: async () => {
        throw new Error("offline");
      }
    });

    await reconciler.reconcileSlot("slot-beta", "fleet-ready");

    const snapshots = useProTradeIndexStore.getState().snapshots;
    expect(snapshots["slot-beta:lake:91234"]).toMatchObject({
      freshness: "error",
      errorCode: "order-unavailable",
      lastOrderId: 91234
    });
    expect(snapshots["slot-beta:lake:91234"]?.order).toBeUndefined();
    expect(getRobotOrderAvailability(beta, snapshots).available).toBe(false);
  });

  it("coalesces concurrent reads of the same Fleet order", async () => {
    let resolveOrder: ((value: OrderDto) => void) | undefined;
    const fetchOrder = vi.fn(() => new Promise<OrderDto>((resolve) => {
      resolveOrder = resolve;
    }));
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => robotResult(91234),
      fetchOrder
    });
    const locator: ProTradeLocator = { slotId: "slot-beta", shortAlias: "lake", orderId: 91234 };

    const first = reconciler.reconcileOrder(locator, "interval");
    const second = reconciler.reconcileOrder(locator, "order-action");
    await vi.waitFor(() => expect(fetchOrder).toHaveBeenCalledOnce());
    resolveOrder?.(order({ id: 91234, status: 9 }));
    await Promise.all([first, second]);

    expect(fetchOrder).toHaveBeenCalledOnce();
    expect(useProTradeIndexStore.getState().snapshots["slot-beta:lake:91234"]).toMatchObject({
      order: { id: 91234, status: 9 }
    });
  });

  it("suppresses rapid automatic Fleet waves after a successful attempt", async () => {
    let now = 1_000;
    const refreshRobotSlot = vi.fn(async () => ({
      slotId: "slot-beta",
      coordinators: [{ shortAlias: "lake", found: false }]
    }));
    const reconciler = new GarageReconciler({
      now: () => now,
      getSlots: () => useGarageStore.getState().slots,
      getCoordinators: () => [coordinator],
      refreshRobotSlot,
      fetchOrder: vi.fn()
    });

    await reconciler.reconcileSlot("slot-beta", "fleet-ready");
    now += 1_000;
    await reconciler.reconcileSlot("slot-beta", "tor-reconnected");
    expect(refreshRobotSlot).toHaveBeenCalledOnce();

    await reconciler.reconcileSlot("slot-beta", "manual");
    expect(refreshRobotSlot).toHaveBeenCalledTimes(2);
  });

  it("backs off a failed coordinator across Fleet slots while manual refresh bypasses it", async () => {
    let now = 1_000;
    const gamma = makeSlot("gamma", "slot-gamma", "Gamma");
    useGarageStore.setState({ slots: [alpha, beta, gamma], currentToken: "alpha", hydrated: true });
    const failed = {
      shortAlias: "lake",
      error: "offline",
      transportFailed: true
    };
    const refreshRobotSlot = vi.fn(async (
      token: string,
      _coordinators: CoordinatorSummary[],
      options?: RefreshRobotSlotOptions
    ) => {
      options?.onCoordinatorResult?.(failed);
      return {
        slotId: useGarageStore.getState().slots.find((slot) => slot.token === token)?.tokenSHA256 ?? "",
        coordinators: [failed]
      };
    });
    const reconciler = new GarageReconciler({
      now: () => now,
      getSlots: () => useGarageStore.getState().slots,
      getCoordinators: () => [coordinator],
      refreshRobotSlot,
      fetchOrder: vi.fn()
    });

    await reconciler.reconcileSlot("slot-alpha", "interval");
    now += 100;
    await reconciler.reconcileSlot("slot-beta", "interval");
    now += 100;
    await reconciler.reconcileSlot("slot-gamma", "interval");

    expect(refreshRobotSlot).toHaveBeenCalledTimes(2);
    expect(useProTradeIndexStore.getState().syncBySlot["slot-gamma"]).toMatchObject({
      attemptedCoordinators: 0,
      inFlight: false
    });

    await reconciler.reconcileSlot("slot-gamma", "manual");
    expect(refreshRobotSlot).toHaveBeenCalledTimes(3);
  });

  it("discovers enabled coordinators whenever a restored Fleet becomes ready", async () => {
    const restored = {
      ...beta,
      robots: {
        local: {
          token: beta.token,
          tokenSHA256: beta.tokenSHA256,
          shortAlias: "local"
        }
      }
    };
    useGarageStore.setState({ slots: [restored], currentToken: restored.token, hydrated: true });
    const refreshRobotSlot = vi.fn(async () => ({ slotId: restored.tokenSHA256, coordinators: [] }));
    const reconciler = makeReconciler({
      refreshRobotSlot,
      fetchOrder: vi.fn()
    });

    await reconciler.reconcileSlot(restored.tokenSHA256, "startup");
    await reconciler.reconcileSlot(restored.tokenSHA256, "fleet-ready");

    expect(refreshRobotSlot).toHaveBeenCalledOnce();
    expect(refreshRobotSlot).toHaveBeenLastCalledWith(restored.token, [coordinator], {
      maxAgeMs: undefined,
      onCoordinatorResult: expect.any(Function),
      preferredAliases: [],
      priority: "foreground",
      source: "fleet-reconcile"
    });
  });

  it("keeps a newly generated empty robot locally ready until its idle check is due", async () => {
    const refreshRobotSlot = vi.fn(async () => ({
      slotId: "slot-beta",
      coordinators: [{ shortAlias: "lake", found: false }]
    }));
    const reconciler = makeReconciler({
      refreshRobotSlot,
      fetchOrder: vi.fn()
    });
    useProTradeIndexStore.getState().setSlotSync({
      slotId: "slot-beta",
      epoch: 0,
      inFlight: false,
      locallyReadyAt: 1_000,
      nextEligibleAt: 100_000
    });

    await reconciler.reconcileSlot("slot-beta", "fleet-ready");
    expect(refreshRobotSlot).not.toHaveBeenCalled();

    await reconciler.reconcileSlot("slot-beta", "manual");
    expect(refreshRobotSlot).toHaveBeenCalledOnce();
  });

  it("records that no coordinator was attempted when none are available", async () => {
    const refreshRobotSlot = vi.fn();
    const reconciler = makeReconciler({
      getCoordinators: () => [],
      refreshRobotSlot,
      fetchOrder: vi.fn()
    });

    await reconciler.reconcileSlot("slot-beta", "manual");

    expect(refreshRobotSlot).not.toHaveBeenCalled();
    expect(useProTradeIndexStore.getState().syncBySlot["slot-beta"]).toMatchObject({
      attemptedCoordinators: 0,
      inFlight: false
    });
  });

  it("records attempted coordinators when every refresh fails", async () => {
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => ({
        slotId: "slot-beta",
        coordinators: [{ shortAlias: "lake", error: "offline" }]
      }),
      fetchOrder: vi.fn()
    });

    await reconciler.reconcileSlot("slot-beta", "manual");

    expect(useProTradeIndexStore.getState().syncBySlot["slot-beta"]).toMatchObject({
      attemptedCoordinators: 1,
      inFlight: false,
      error: "refresh-failed"
    });
  });

  it("uses recent robot state during interval polling while still refreshing known orders", async () => {
    const prior = existingSnapshot();
    useProTradeIndexStore.getState().upsertSnapshot(prior);
    const refreshRobotSlot = vi.fn(async (
      _token: string,
      _coordinators: CoordinatorSummary[],
      _options?: RefreshRobotSlotOptions
    ) => ({
      slotId: "slot-beta",
      coordinators: [{
        shortAlias: "lake",
        cached: true,
        found: true,
        activeOrderId: 91234,
        lastOrderId: 91234
      }]
    }));
    const fetchOrder = vi.fn(async () => order({ id: 91234, status: 9 }));
    const reconciler = makeReconciler({ refreshRobotSlot, fetchOrder });

    await reconciler.reconcileSlot("slot-beta", "interval");

    expect(refreshRobotSlot).toHaveBeenCalledWith(beta.token, [coordinator], expect.objectContaining({
      maxAgeMs: 300_000,
      priority: "background"
    }));
    expect(fetchOrder).toHaveBeenCalledOnce();
    expect(useProTradeIndexStore.getState().syncBySlot["slot-beta"]).toMatchObject({
      attemptedCoordinators: 0,
      error: undefined
    });
  });

  it("refreshes a known order directly and preserves it when robot discovery fails", async () => {
    const prior = existingSnapshot();
    useProTradeIndexStore.getState().upsertSnapshot(prior);
    const fetchOrder = vi.fn(async () => {
      throw new Error("offline");
    });
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => ({
        slotId: "slot-beta",
        coordinators: [{ shortAlias: "lake", activeOrderId: 91234, error: "offline" }]
      }),
      fetchOrder
    });

    await reconciler.reconcileSlot("slot-beta", "manual");

    expect(fetchOrder).toHaveBeenCalledOnce();
    expect(useProTradeIndexStore.getState().snapshots[prior.key]).toMatchObject({
      order: { id: 91234, status: 9 },
      freshness: "fresh",
      errorCode: "coordinator-unavailable"
    });
  });

  it("indexes a healthy coordinator before another coordinator refresh settles", async () => {
    const temple = {
      ...coordinator,
      shortAlias: "temple",
      longAlias: "Temple",
      url: "https://temple.example"
    };
    let resolveBatch: ((result: RefreshRobotSlotResult) => void) | undefined;
    const fetchOrder = vi.fn(async () => order({ id: 91234, status: 9, shortAlias: "lake" }));
    const refreshRobotSlot = vi.fn((
      _token: string,
      _coordinators: CoordinatorSummary[],
      options?: {
        onCoordinatorResult?: (result: RefreshRobotSlotResult["coordinators"][number]) => void;
      }
    ) => {
      const observer = options?.onCoordinatorResult;
      observer?.({
        shortAlias: "lake",
        found: true,
        activeOrderId: 91234,
        lastOrderId: 91234
      });
      return new Promise<RefreshRobotSlotResult>((resolve) => {
        resolveBatch = resolve;
      });
    });
    const reconciler = new GarageReconciler({
      now: () => 1_000,
      getSlots: () => useGarageStore.getState().slots,
      getCoordinators: () => [coordinator, temple],
      refreshRobotSlot,
      fetchOrder
    });

    const refresh = reconciler.reconcileSlot("slot-beta", "manual");
    await vi.waitFor(() => expect(fetchOrder).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      expect(useProTradeIndexStore.getState().snapshots["slot-beta:lake:91234"]).toMatchObject({
        freshness: "fresh",
        order: { id: 91234 }
      });
    });
    resolveBatch?.({
      slotId: "slot-beta",
      coordinators: [
        { shortAlias: "lake", found: true, activeOrderId: 91234, lastOrderId: 91234 },
        { shortAlias: "temple", transportFailed: true, error: "offline" }
      ]
    });
    await refresh;
  });

  it("ignores an order response made obsolete by a foreground action", async () => {
    let resolveOrder: ((value: OrderDto) => void) | undefined;
    const fetchOrder = vi.fn(() => new Promise<OrderDto>((resolve) => {
      resolveOrder = resolve;
    }));
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => robotResult(91234),
      fetchOrder
    });
    const locator: ProTradeLocator = { slotId: "slot-beta", shortAlias: "lake", orderId: 91234 };

    const refresh = reconciler.reconcileSlot("slot-beta", "manual");
    await vi.waitFor(() => expect(fetchOrder).toHaveBeenCalledOnce());
    markProOrderActionStarted(locator);
    markProOrderActionFinished(locator);
    resolveOrder?.(order({ id: 91234, status: 9 }));
    await refresh;

    expect(useProTradeIndexStore.getState().snapshots["slot-beta:lake:91234"]).toBeUndefined();
  });

  it("ignores an order failure made obsolete by a foreground action", async () => {
    let rejectOrder: ((reason: Error) => void) | undefined;
    const fetchOrder = vi.fn(() => new Promise<OrderDto>((_resolve, reject) => {
      rejectOrder = reject;
    }));
    const prior = existingSnapshot();
    useProTradeIndexStore.getState().upsertSnapshot(prior);
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => robotResult(91234),
      fetchOrder
    });
    const locator: ProTradeLocator = { slotId: "slot-beta", shortAlias: "lake", orderId: 91234 };

    const refresh = reconciler.reconcileOrder(locator, "order-action");
    await vi.waitFor(() => expect(fetchOrder).toHaveBeenCalledOnce());
    markProOrderActionStarted(locator);
    useProTradeIndexStore.getState().removeTrade(locator);
    markProOrderActionFinished(locator);
    rejectOrder?.(new Error("The coordinator is temporarily unavailable."));
    await refresh;

    expect(useProTradeIndexStore.getState().snapshots[prior.key]).toBeUndefined();
  });

  it("does not let an older background response overwrite a renewed maker offer", async () => {
    let resolveOrder: ((value: OrderDto) => void) | undefined;
    const fetchOrder = vi.fn(() => new Promise<OrderDto>((resolve) => {
      resolveOrder = resolve;
    }));
    const expired = {
      ...existingSnapshot(),
      order: order({ id: 91234, status: 5, is_maker: true, is_taker: false }),
      renewable: true
    };
    useProTradeIndexStore.getState().upsertSnapshot(expired);
    const reconciler = makeReconciler({ refreshRobotSlot: async () => robotResult(91234), fetchOrder });

    const refresh = reconciler.reconcileOrder(expired.locator, "interval");
    await vi.waitFor(() => expect(fetchOrder).toHaveBeenCalledOnce());
    markProOrderActionStarted(expired.locator);
    useProTradeIndexStore.getState().removeTrade(expired.locator);
    markProOrderActionFinished(expired.locator);
    resolveOrder?.(expired.order!);
    await refresh;

    expect(useProTradeIndexStore.getState().snapshots[expired.key]).toBeUndefined();
  });

  it("removes a cancelled order when its follow-up GET returns error 1043", async () => {
    const activeBeta = {
      ...beta,
      activeOrderId: 91234,
      lastOrderId: 91234,
      robots: {
        lake: { ...beta.robots.lake, activeOrderId: 91234, lastOrderId: 91234 }
      }
    };
    useGarageStore.setState({ slots: [alpha, activeBeta], currentToken: "alpha", hydrated: true });
    const prior = {
      ...existingSnapshot(),
      order: order({ id: 91234, status: 1, is_maker: true, is_taker: false })
    };
    useProTradeIndexStore.getState().upsertSnapshot(prior);
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => robotResult(91234),
      fetchOrder: async () => {
        throw new Error('RoboSats API 400: {"error_code":1043,"bad_request":"This order has been cancelled"}');
      }
    });

    await reconciler.reconcileOrder(prior.locator, "order-action");

    const refreshed = useGarageStore.getState().slots[1];
    expect(refreshed.activeOrderId).toBeUndefined();
    expect(refreshed.lastOrderId).toBe(91234);
    expect(useProTradeIndexStore.getState().snapshots[prior.key]).toBeUndefined();
  });

  it("removes an expired taker reservation after authoritative public status", async () => {
    const activeBeta = {
      ...beta,
      activeOrderId: 91234,
      lastOrderId: 91234,
      robots: {
        lake: { ...beta.robots.lake, activeOrderId: 91234, lastOrderId: 91234 }
      }
    };
    useGarageStore.setState({ slots: [alpha, activeBeta], currentToken: "alpha", hydrated: true });
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => robotResult(91234),
      fetchOrder: async () => order({ id: 91234, status: 1, is_maker: false, is_taker: false })
    });

    await reconciler.reconcileSlot("slot-beta", "manual");

    const refreshed = useGarageStore.getState().slots[1];
    expect(refreshed.activeOrderId).toBeUndefined();
    expect(refreshed.robots.lake.releasedOrderId).toBe(91234);
    expect(useProTradeIndexStore.getState().snapshots["slot-beta:lake:91234"]).toBeUndefined();
  });

  it("accepts a valid Nostr hint once and refreshes its authoritative order", async () => {
    const fetchOrder = vi.fn(async () => order({ id: 91234, status: 9 }));
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => robotResult(91234),
      fetchOrder
    });
    const hint = {
      recipientPubkey: "nostr-beta",
      coordinatorPubkey: "coordinator-pubkey",
      shortAlias: "lake",
      orderId: 91234,
      eventId: "hint-1",
      createdAt: 1
    };

    await reconciler.handleOrderHint(hint);
    await reconciler.handleOrderHint(hint);

    expect(fetchOrder).toHaveBeenCalledOnce();
    expect(useProTradeIndexStore.getState().snapshots["slot-beta:lake:91234"]).toMatchObject({
      freshness: "fresh",
      order: { id: 91234, status: 9 }
    });
  });

  it("rejects Nostr hints that are stale or do not match the coordinator identity", async () => {
    const fetchOrder = vi.fn(async () => order({ id: 91234, status: 9 }));
    const reconciler = makeReconciler({
      refreshRobotSlot: async () => robotResult(91234),
      fetchOrder
    });
    const hint = {
      recipientPubkey: "nostr-beta",
      coordinatorPubkey: "wrong-pubkey",
      shortAlias: "lake",
      orderId: 91234,
      eventId: "hint-2",
      createdAt: 1
    };

    await reconciler.handleOrderHint(hint);
    await reconciler.handleOrderHint({
      ...hint,
      coordinatorPubkey: "coordinator-pubkey",
      eventId: "hint-3",
      createdAt: -700_000
    });

    expect(fetchOrder).not.toHaveBeenCalled();
  });
});

function makeReconciler(overrides: {
  getCoordinators?: () => CoordinatorSummary[];
  refreshRobotSlot: (token: string, coordinators: CoordinatorSummary[]) => Promise<RefreshRobotSlotResult>;
  fetchOrder: (coordinator: CoordinatorSummary, orderId: number, slot: RobotSlot) => Promise<OrderDto>;
}) {
  let now = 1000;
  return new GarageReconciler({
    now: () => ++now,
    getSlots: () => useGarageStore.getState().slots,
    getCoordinators: () => [coordinator],
    ...overrides
  });
}

function robotResult(orderId: number): RefreshRobotSlotResult {
  return {
    slotId: "slot-beta",
    coordinators: [{ shortAlias: "lake", found: true, activeOrderId: orderId, lastOrderId: orderId }]
  };
}

function makeSlot(token: string, tokenSHA256: string, nickname: string): RobotSlot {
  return {
    token,
    hashId: `hash-${token}`,
    tokenSHA256,
    nostrPubKey: `nostr-${token}`,
    nostrSecKey: new Uint8Array(32),
    entropyBits: 216,
    hasEnoughEntropy: true,
    shannonEntropy: 5,
    nickname,
    earnedRewards: 0,
    robots: {
      lake: {
        token,
        tokenSHA256,
        shortAlias: "lake",
        pubKey: "pub",
        encPrivKey: "priv",
        nostrPubKey: `nostr-${token}`
      }
    }
  };
}

function existingSnapshot(): ProTradeSnapshot {
  return {
    key: "slot-beta:lake:91234",
    locator: { slotId: "slot-beta", shortAlias: "lake", orderId: 91234 },
    nickname: "Beta",
    hashId: "hash-beta",
    order: order({ id: 91234, status: 9 }),
    activeOrderId: 91234,
    lastOrderId: 91234,
    renewable: false,
    released: false,
    freshness: "fresh",
    updatedAt: 1,
    changedAt: 1
  };
}

function order(overrides: Partial<OrderDto> = {}): OrderDto {
  return {
    id: 1,
    status: 9,
    type: 0,
    amount: 100,
    currency: 1,
    payment_method: "SEPA",
    premium: 0,
    satoshis: 1000,
    is_maker: false,
    is_taker: true,
    is_buyer: true,
    is_seller: false,
    maker_nick: "Maker",
    maker_hash_id: "maker",
    taker_nick: "Taker",
    taker_hash_id: "taker",
    bond_invoice: "",
    bond_satoshis: 0,
    escrow_invoice: "",
    escrow_satoshis: 0,
    invoice_amount: 0,
    swap_allowed: false,
    suggested_mining_fee_rate: 0,
    swap_fee_rate: 0,
    expires_at: "2026-07-21T12:00:00Z",
    shortAlias: "lake",
    ...overrides
  };
}
