import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderDto } from "@/domains/orders/order.types";
import {
  loadProTradeRuntimeCache,
  persistProTradeRuntimeCache,
  PRO_TRADE_CACHE_STORAGE_KEY
} from "@/domains/pro/proTradeCache";
import type { ProTradeSnapshot, SlotSyncState } from "@/domains/pro/pro.types";
import { createGarageSecret } from "@/domains/pro/garageVault";

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("PRO trade cache", () => {
  it("round trips sanitized status without exposing robot or order details", () => {
    const secret = createGarageSecret();
    const snapshot = tradeSnapshot();
    const sync = syncState();

    persistProTradeRuntimeCache(
      secret,
      { snapshots: { [snapshot.key]: snapshot }, syncBySlot: { [sync.slotId]: sync } },
      new Set(["slot-alpha"]),
      20_000
    );

    const raw = storage.get(PRO_TRADE_CACHE_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("QuietRobot");
    expect(raw).not.toContain("SEPA");
    expect(raw).not.toContain("lnbc-sensitive");

    const restored = loadProTradeRuntimeCache(secret, new Set(["slot-alpha"]));
    expect(restored.snapshots[snapshot.key]).toMatchObject({
      nickname: "QuietRobot",
      freshness: "fresh",
      order: {
        id: 42,
        status: 9,
        payment_method: "SEPA",
        bond_invoice: "",
        escrow_invoice: ""
      }
    });
    expect(restored.syncBySlot["slot-alpha"]).toMatchObject({
      epoch: 0,
      inFlight: false,
      locallyReadyAt: 17_000,
      lastSuccessAt: 18_000
    });
  });

  it("drops cache data that belongs to another Fleet key", () => {
    const secret = createGarageSecret();
    const snapshot = tradeSnapshot();
    persistProTradeRuntimeCache(
      secret,
      { snapshots: { [snapshot.key]: snapshot }, syncBySlot: {} },
      new Set(["slot-alpha"])
    );

    expect(loadProTradeRuntimeCache(createGarageSecret(), new Set(["slot-alpha"]))).toEqual({
      snapshots: {},
      syncBySlot: {}
    });
    expect(storage.has(PRO_TRADE_CACHE_STORAGE_KEY)).toBe(false);
  });

  it("filters robots that are no longer part of the Fleet", () => {
    const secret = createGarageSecret();
    const snapshot = tradeSnapshot();
    persistProTradeRuntimeCache(
      secret,
      { snapshots: { [snapshot.key]: snapshot }, syncBySlot: { "slot-alpha": syncState() } },
      new Set(["slot-alpha"])
    );

    expect(loadProTradeRuntimeCache(secret, new Set(["slot-beta"]))).toEqual({
      snapshots: {},
      syncBySlot: {}
    });
  });
});

function syncState(): SlotSyncState {
  return {
    slotId: "slot-alpha",
    epoch: 5,
    inFlight: true,
    attemptedCoordinators: 2,
    locallyReadyAt: 17_000,
    lastAttemptAt: 19_000,
    lastSuccessAt: 18_000,
    nextEligibleAt: 21_000
  };
}

function tradeSnapshot(): ProTradeSnapshot {
  const order = {
    id: 42,
    status: 9,
    type: 0,
    amount: 100,
    currency: 1,
    payment_method: "SEPA",
    premium: 1,
    satoshis: 1000,
    is_maker: true,
    is_taker: false,
    is_buyer: true,
    is_seller: false,
    maker_nick: "SensitiveMaker",
    maker_hash_id: "maker-hash",
    taker_nick: "SensitiveTaker",
    taker_hash_id: "taker-hash",
    bond_invoice: "lnbc-sensitive",
    bond_satoshis: 100,
    escrow_invoice: "lnbc-sensitive-escrow",
    escrow_satoshis: 1000,
    invoice_amount: 1000,
    swap_allowed: false,
    suggested_mining_fee_rate: 1,
    swap_fee_rate: 0,
    expires_at: "2026-07-23T12:00:00Z",
    shortAlias: "lake"
  } satisfies OrderDto;
  return {
    key: "slot-alpha:lake:42",
    locator: { slotId: "slot-alpha", shortAlias: "lake", orderId: 42 },
    nickname: "QuietRobot",
    hashId: "robot-hash",
    order,
    activeOrderId: 42,
    lastOrderId: 42,
    renewable: false,
    released: false,
    freshness: "fresh",
    updatedAt: 18_000,
    changedAt: 17_000
  };
}
