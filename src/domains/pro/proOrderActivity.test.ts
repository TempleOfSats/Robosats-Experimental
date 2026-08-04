import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import { buildProvisionalMakerOrder } from "@/domains/maker/makerApi";
import {
  ingestCoordinatorOrder,
  recordCoordinatorSettlement,
  resetCoordinatorOrderActivityForTests
} from "@/domains/orders/orderActivity";
import type { OrderDto } from "@/domains/orders/order.types";
import { classifyProTrade } from "@/domains/pro/proSelectors";
import { recordProSettlementInvoice, startProOrderActivityBridge } from "@/domains/pro/proOrderActivity";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import { createGarageManifest, garageTokenId, upsertGarageEntry } from "@/domains/pro/garageVault";
import { resetGarageVaultRuntimeForTests, useGarageVaultStore } from "@/domains/pro/garageVaultStore";

const slot = makeSlot();
let stopBridge: (() => void) | undefined;

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  resetCoordinatorOrderActivityForTests();
  resetGarageVaultRuntimeForTests();
  useGarageStore.setState({ slots: [slot], currentToken: slot.token, hydrated: true });
  useProTradeIndexStore.getState().resetRuntimeCache();
  useGarageVaultStore.setState({
    status: "ready",
    archiveTrade: vi.fn((input) =>
      input.order.status === 12 ||
      input.order.status === 14 ||
      (input.order.is_seller && [13, 15].includes(input.order.status))
        ? "archived"
        : "ineligible"
    ),
    manifest: upsertGarageEntry(
      createGarageManifest("a".repeat(32), 1),
      {
        id: "b".repeat(32),
        tokenId: garageTokenId(slot.token),
        nickname: slot.nickname
      },
      2
    )
  });
  stopBridge = startProOrderActivityBridge();
});

afterEach(() => {
  stopBridge?.();
  stopBridge = undefined;
  resetCoordinatorOrderActivityForTests();
  resetGarageVaultRuntimeForTests();
  vi.unstubAllGlobals();
});

describe("foreground order activity", () => {
  it("shows a newly created maker offer as needing action before its first GET completes", () => {
    const provisional = buildProvisionalMakerOrder(
      42,
      "lake",
      {
        type: 0,
        currency: 1,
        amount: 150,
        has_range: false,
        min_amount: null,
        max_amount: null,
        payment_method: "Revolut",
        is_explicit: false,
        premium: 1,
        satoshis: null,
        public_duration: 86_400,
        escrow_duration: 10_800,
        bond_size: 3,
        latitude: 0,
        longitude: 0,
        password: null,
        description: null
      },
      slot
    );

    ingestCoordinatorOrder({ authoritative: false, order: provisional, shortAlias: "lake", slot });

    const snapshot = useProTradeIndexStore.getState().snapshots["slot-id:lake:42"];
    expect(snapshot).toMatchObject({ freshness: "refreshing", order: { status: 0, is_maker: true } });
    expect(classifyProTrade(snapshot)).toBe("needs-action");
    expect(useGarageStore.getState().slots[0].activeOrderId).toBe(42);
  });

  it("replaces provisional data from the same coordinator GET without another reconciliation", () => {
    ingestCoordinatorOrder({
      authoritative: false,
      order: order({ id: 42, status: 0, is_maker: true, is_taker: false }),
      shortAlias: "lake",
      slot
    });
    ingestCoordinatorOrder({
      order: order({ id: 42, status: 1, is_maker: true, is_taker: false, amount: 250 }),
      shortAlias: "lake",
      slot
    });

    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:42"]).toMatchObject({
      freshness: "fresh",
      order: { status: 1, amount: 250 }
    });
  });

  it("removes a terminal order as soon as the coordinator returns it", () => {
    ingestCoordinatorOrder({
      order: order({ id: 42, status: 9, is_maker: true, is_taker: false }),
      shortAlias: "lake",
      slot
    });
    ingestCoordinatorOrder({
      order: order({ id: 42, status: 4, is_maker: true, is_taker: false }),
      shortAlias: "lake",
      slot
    });

    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:42"]).toBeUndefined();
    expect(useGarageStore.getState().slots[0].activeOrderId).toBeUndefined();
  });

  it("releases an expired taker attempt when the order is public again", () => {
    ingestCoordinatorOrder({
      order: order({ id: 42, status: 3, is_maker: false, is_taker: true }),
      shortAlias: "lake",
      slot
    });
    ingestCoordinatorOrder({
      order: order({ id: 42, status: 1, is_maker: false, is_taker: false }),
      shortAlias: "lake",
      slot
    });

    const current = useGarageStore.getState().slots[0];
    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:42"]).toBeUndefined();
    expect(current.activeOrderId).toBeUndefined();
    expect(current.robots.lake.releasedOrderId).toBe(42);
  });

  it("retains only role-correct settlement invoices in the encrypted trade snapshot", () => {
    ingestCoordinatorOrder({
      order: order({ id: 42, status: 8, is_buyer: true, is_seller: false }),
      shortAlias: "lake",
      slot
    });
    expect(
      recordProSettlementInvoice(
        { slotId: slot.tokenSHA256, shortAlias: "lake", orderId: 42 },
        "payout-received",
        "lnbc1000n1buyerinvoice0123456789"
      )
    ).toBe(true);
    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:42"]).toMatchObject({
      settlementInvoice: "lnbc1000n1buyerinvoice0123456789",
      settlementInvoicePurpose: "payout-received"
    });

    ingestCoordinatorOrder({
      order: order({
        id: 43,
        status: 6,
        is_buyer: false,
        is_seller: true,
        escrow_locked: false,
        escrow_invoice: "lnbc2000n1sellerinvoice0123456789"
      }),
      shortAlias: "lake",
      slot
    });
    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:43"]).toMatchObject({
      settlementInvoice: "lnbc2000n1sellerinvoice0123456789",
      settlementInvoicePurpose: "escrow-paid"
    });

    ingestCoordinatorOrder({
      order: order({
        id: 43,
        status: 8,
        is_buyer: false,
        is_seller: true,
        escrow_locked: true,
        escrow_invoice: ""
      }),
      shortAlias: "lake",
      slot
    });
    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:43"]).toMatchObject({
      settlementInvoice: "lnbc2000n1sellerinvoice0123456789",
      settlementInvoicePurpose: "escrow-paid"
    });
  });

  it("replays a foreground payout submission after the Pro runtime loads lazily", () => {
    stopBridge?.();
    stopBridge = undefined;
    useProTradeIndexStore.getState().resetRuntimeCache();

    ingestCoordinatorOrder({
      order: order({ id: 42, status: 8, is_buyer: true, is_seller: false }),
      shortAlias: "lake",
      slot
    });
    recordCoordinatorSettlement({
      slotId: slot.tokenSHA256,
      shortAlias: "lake",
      orderId: 42,
      purpose: "payout-received",
      value: "lnbc1000n1buyerinvoice0123456789"
    });

    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:42"]).toBeUndefined();
    stopBridge = startProOrderActivityBridge();

    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:42"]).toMatchObject({
      settlementInvoice: "lnbc1000n1buyerinvoice0123456789",
      settlementInvoicePurpose: "payout-received"
    });
  });

  it("keeps status 15 active only for the buyer whose payout failed", () => {
    ingestCoordinatorOrder({
      order: order({
        id: 42,
        status: 15,
        is_buyer: true,
        is_seller: false,
        retries: 1,
        next_retry_time: "2026-07-23T12:05:00Z"
      }),
      shortAlias: "lake",
      slot
    });
    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:42"]).toMatchObject({
      order: { status: 15, retries: 1 }
    });

    ingestCoordinatorOrder({
      order: order({
        id: 45,
        status: 15,
        is_buyer: true,
        is_seller: false
      }),
      shortAlias: "lake",
      slot
    });
    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:45"]).toMatchObject({
      order: { status: 15 }
    });

    ingestCoordinatorOrder({
      order: order({
        id: 43,
        status: 15,
        is_buyer: false,
        is_seller: true
      }),
      shortAlias: "lake",
      slot
    });
    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:43"]).toBeUndefined();
  });

  it("removes a completed seller trade while the buyer payout resolves", () => {
    ingestCoordinatorOrder({
      order: order({
        id: 44,
        status: 13,
        is_buyer: false,
        is_seller: true
      }),
      shortAlias: "lake",
      slot
    });

    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:44"]).toBeUndefined();
    expect(useGarageStore.getState().slots[0].activeOrderId).toBeUndefined();
  });

  it("retains a terminal snapshot until the encrypted history can archive it", () => {
    useGarageVaultStore.setState({ archiveTrade: vi.fn(() => "deferred" as const) });

    ingestCoordinatorOrder({
      order: order({ id: 45, status: 14, is_buyer: true, is_seller: false }),
      shortAlias: "lake",
      slot
    });

    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:45"]).toMatchObject({
      order: { id: 45, status: 14 }
    });
  });

  it.each([17, 18])("removes resolved dispute status %i from active trades", (status) => {
    const archiveTrade = vi.fn(() => "ineligible" as const);
    useGarageVaultStore.setState({ archiveTrade });

    ingestCoordinatorOrder({
      order: order({ id: 30 + status, status }),
      shortAlias: "lake",
      slot
    });

    expect(archiveTrade).toHaveBeenCalledOnce();
    expect(useProTradeIndexStore.getState().snapshots[`slot-id:lake:${30 + status}`]).toBeUndefined();
  });

  it("retains the fresh terminal state and retries after history archival throws", () => {
    const archiveTrade = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("Encrypted history is temporarily unavailable.");
      })
      .mockReturnValue("archived" as const);
    useGarageVaultStore.setState({ archiveTrade });

    ingestCoordinatorOrder({
      order: order({ id: 46, status: 13, is_buyer: false, is_seller: true }),
      shortAlias: "lake",
      slot
    });

    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:46"]).toMatchObject({
      freshness: "fresh",
      order: { id: 46, status: 13 }
    });

    stopBridge?.();
    stopBridge = undefined;
    stopBridge = startProOrderActivityBridge();

    expect(archiveTrade).toHaveBeenCalledTimes(2);
    expect(useProTradeIndexStore.getState().snapshots["slot-id:lake:46"]).toBeUndefined();
  });
});

function makeSlot(): RobotSlot {
  return {
    token: "robot-token-with-enough-entropy-123456",
    hashId: "robot-hash",
    tokenSHA256: "slot-id",
    nostrPubKey: "nostr-public",
    nostrSecKey: new Uint8Array(32),
    entropyBits: 216,
    hasEnoughEntropy: true,
    shannonEntropy: 5,
    nickname: "Robot",
    earnedRewards: 0,
    robots: {
      lake: {
        token: "robot-token-with-enough-entropy-123456",
        tokenSHA256: "slot-id",
        nostrPubKey: "nostr-public",
        shortAlias: "lake"
      }
    }
  };
}

function order(overrides: Partial<OrderDto> = {}): OrderDto {
  return {
    id: 42,
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
    expires_at: "2026-07-23T12:00:00Z",
    shortAlias: "lake",
    ...overrides
  };
}
