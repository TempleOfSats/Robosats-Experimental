import { describe, expect, it } from "vitest";
import type { OrderDto } from "@/domains/orders/order.types";
import {
  archiveTradeHistoryEntry,
  createTradeHistoryManifest,
  mergeTradeHistoryManifests,
  TRADE_HISTORY_LIMITS,
  tradeHistoryEntryFromOrder,
  upsertTradeHistoryEntry,
  validateTradeHistoryManifest
} from "@/domains/pro/tradeHistory";
import { hexToBase91 } from "@/lib/hexToBase91";

const deviceId = "00112233445566778899aabbccddeeff";
const slotId = hexToBase91("a".repeat(64));
const now = Date.UTC(2026, 6, 26);

describe("Fleet trade history", () => {
  it("archives only finalized trade outcomes with sanitized fields", () => {
    expect(entryFor(order({ status: 1 }))).toBeUndefined();
    expect(entryFor(order({ status: 4 }))).toBeUndefined();
    expect(entryFor(order({ status: 5 }))).toBeUndefined();

    const entry = entryFor(
      order({
        status: 14,
        address: "bc1-sensitive",
        bond_invoice: "ln-sensitive",
        maker_nostr_pubkey: "peer-pubkey"
      })
    );
    expect(entry).toMatchObject({
      role: "buyer",
      origin: "taker",
      outcome: "completed",
      orderId: 42,
      amount: 100,
      paymentMethod: "SEPA"
    });
    expect(JSON.stringify(entry)).not.toContain("sensitive");
    expect(JSON.stringify(entry)).not.toContain("peer-pubkey");
  });

  it("validates production Base91 slot IDs while retaining legacy hex history", () => {
    const current = entryFor(order())!;
    const legacy = { ...current, slotId: "a".repeat(64) };

    expect(slotId).toHaveLength(40);
    expect(() =>
      validateTradeHistoryManifest({
        ...createTradeHistoryManifest(deviceId, now),
        entries: [current]
      })
    ).not.toThrow();
    expect(() =>
      validateTradeHistoryManifest({
        ...createTradeHistoryManifest(deviceId, now),
        entries: [legacy]
      })
    ).not.toThrow();
  });

  it("archives resolved disputes from the current robot's perspective", () => {
    expect(entryFor(order({ status: 17, is_maker: false, is_taker: true }))).toMatchObject({ outcome: "dispute-won" });
    expect(entryFor(order({ status: 17, is_maker: true, is_taker: false }))).toMatchObject({ outcome: "dispute-lost" });
    expect(entryFor(order({ status: 18, is_maker: true, is_taker: false }))).toMatchObject({ outcome: "dispute-won" });
    expect(entryFor(order({ status: 18, is_maker: false, is_taker: true }))).toMatchObject({ outcome: "dispute-lost" });
  });

  it("archives a seller when payout routing becomes the buyer's concern", () => {
    expect(
      entryFor(
        order({
          status: 13,
          is_buyer: false,
          is_seller: true,
          is_maker: true,
          is_taker: false
        })
      )
    ).toMatchObject({ outcome: "completed", role: "seller" });
  });

  it("archives the role-specific contract bitcoin amount", () => {
    expect(
      entryFor(
        order({
          invoice_amount: 18_915,
          trade_satoshis: 18_958,
          taker_summary: { is_buyer: true, received_sats: 18_800 }
        })
      )
    ).toMatchObject({ role: "buyer", satoshis: 18_915 });

    expect(
      entryFor(
        order({
          is_buyer: false,
          is_seller: true,
          is_maker: true,
          is_taker: false,
          escrow_satoshis: 18_991,
          trade_satoshis: 18_958,
          maker_summary: { is_buyer: false, sent_sats: 18_800 }
        })
      )
    ).toMatchObject({ role: "seller", satoshis: 18_991 });
  });

  it("stores only the invoice matching the robot's settlement role", () => {
    const buyerInvoice = "lnbc1000n1buyerinvoice0123456789";
    const buyer = tradeHistoryEntryFromOrder(
      {
        slotId,
        robotName: "Buyer",
        robotHashId: "buyer-hash",
        coordinatorShortAlias: "lake",
        order: order({ is_buyer: true, is_seller: false }),
        settlementInvoice: buyerInvoice,
        settlementInvoicePurpose: "payout-received",
        observedAt: now
      },
      deviceId
    );
    expect(buyer).toMatchObject({
      settlementInvoice: buyerInvoice,
      settlementInvoicePurpose: "payout-received"
    });

    const sellerInvoice = "lnbc2000n1sellerinvoice0123456789";
    const seller = tradeHistoryEntryFromOrder(
      {
        slotId,
        robotName: "Seller",
        robotHashId: "seller-hash",
        coordinatorShortAlias: "lake",
        order: order({
          status: 15,
          is_buyer: false,
          is_seller: true,
          is_maker: true,
          is_taker: false
        }),
        settlementInvoice: sellerInvoice,
        settlementInvoicePurpose: "escrow-paid",
        observedAt: now
      },
      deviceId
    );
    expect(seller).toMatchObject({
      outcome: "completed",
      settlementInvoice: sellerInvoice,
      settlementInvoicePurpose: "escrow-paid"
    });

    expect(
      tradeHistoryEntryFromOrder(
        {
          slotId,
          robotName: "Buyer",
          robotHashId: "buyer-hash",
          coordinatorShortAlias: "lake",
          order: order(),
          settlementInvoice: sellerInvoice,
          settlementInvoicePurpose: "escrow-paid",
          observedAt: now
        },
        deviceId
      )
    ).not.toHaveProperty("settlementInvoice");

    expect(
      tradeHistoryEntryFromOrder(
        {
          slotId,
          robotName: "Cancelled buyer",
          robotHashId: "buyer-hash",
          coordinatorShortAlias: "lake",
          order: order({ status: 12 }),
          settlementInvoice: buyerInvoice,
          settlementInvoicePurpose: "payout-received",
          observedAt: now
        },
        deviceId
      )
    ).not.toHaveProperty("settlementInvoice");

    expect(
      tradeHistoryEntryFromOrder(
        {
          slotId,
          robotName: "Cancelled seller",
          robotHashId: "seller-hash",
          coordinatorShortAlias: "lake",
          order: order({ status: 12, is_buyer: false, is_seller: true }),
          settlementInvoice: sellerInvoice,
          settlementInvoicePurpose: "escrow-paid",
          observedAt: now
        },
        deviceId
      )
    ).not.toHaveProperty("settlementInvoice");
  });

  it("deduplicates trades and keeps only 100 entries for twelve months", () => {
    let manifest = createTradeHistoryManifest(deviceId, now);
    for (let index = 0; index < 105; index += 1) {
      const entry = entryFor(order({ id: index + 1 }), now - index * 1_000)!;
      manifest = upsertTradeHistoryEntry(manifest, entry, now);
    }
    expect(manifest.entries).toHaveLength(TRADE_HISTORY_LIMITS.entries);
    expect(manifest.entries[0].orderId).toBe(1);
    expect(manifest.entries.at(-1)?.orderId).toBe(100);

    const expired = entryFor(order({ id: 999 }), now - TRADE_HISTORY_LIMITS.retentionMs - 1)!;
    expect(upsertTradeHistoryEntry(manifest, expired, now).entries.some((entry) => entry.orderId === 999)).toBe(false);
    validateTradeHistoryManifest(manifest);
  });

  it("converges deterministic records from different devices without duplicates", () => {
    const first = entryFor(order(), now)!;
    const second = { ...first, deviceId: "f".repeat(32), robotName: "Renamed", updatedAt: now + 1 };
    const left = upsertTradeHistoryEntry(createTradeHistoryManifest(deviceId, now), first, now);
    const right = upsertTradeHistoryEntry(createTradeHistoryManifest("f".repeat(32), now), second, now);

    const merged = mergeTradeHistoryManifests([left, right], deviceId, now + 1);
    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0].robotName).toBe("Renamed");
  });

  it("preserves validated settlement evidence across equal-revision merges", () => {
    const invoice = "lnbc1000n1buyerinvoice0123456789";
    const richer = tradeHistoryEntryFromOrder(
      {
        slotId,
        robotName: "History Robot",
        robotHashId: "robot-hash",
        coordinatorShortAlias: "lake",
        order: order(),
        settlementInvoice: invoice,
        settlementInvoicePurpose: "payout-received",
        observedAt: now
      },
      deviceId
    )!;
    const stale = {
      ...richer,
      satoshis: 0,
      settlementInvoice: undefined,
      settlementInvoicePurpose: undefined,
      deviceId: "f".repeat(32),
      updatedAt: now + 1
    };
    const left = upsertTradeHistoryEntry(createTradeHistoryManifest(deviceId, now), richer, now);
    const right = upsertTradeHistoryEntry(createTradeHistoryManifest("f".repeat(32), now), stale, now);

    for (const manifests of [
      [left, right],
      [right, left]
    ]) {
      expect(mergeTradeHistoryManifests(manifests, deviceId, now + 1).entries[0]).toMatchObject({
        satoshis: 200_000,
        settlementInvoice: invoice,
        settlementInvoicePurpose: "payout-received"
      });
    }
  });

  it("increments local revisions only when archived trade content changes", () => {
    const first = entryFor(order(), now)!;
    const initial = archiveTradeHistoryEntry(createTradeHistoryManifest(deviceId, now), first, now);
    expect(archiveTradeHistoryEntry(initial, first, now + 1)).toBe(initial);

    const invoice = "lnbc1000n1buyerinvoice0123456789";
    const richer = {
      ...first,
      settlementInvoice: invoice,
      settlementInvoicePurpose: "payout-received" as const,
      updatedAt: now + 2
    };
    const updated = archiveTradeHistoryEntry(initial, richer, now + 2);
    expect(updated.entries[0]).toMatchObject({
      revision: 2,
      settlementInvoice: invoice,
      settlementInvoicePurpose: "payout-received"
    });
  });

  it("retains one hundred invoice-heavy entries within the manifest budget", () => {
    const invoice = `lnbc1${"a".repeat(TRADE_HISTORY_LIMITS.invoiceLength - 5)}`;
    let manifest = createTradeHistoryManifest(deviceId, now);
    for (let index = 0; index < TRADE_HISTORY_LIMITS.entries; index += 1) {
      const entry = {
        ...entryFor(order({ id: index + 1 }), now - index)!,
        settlementInvoice: invoice,
        settlementInvoicePurpose: "payout-received" as const
      };
      manifest = upsertTradeHistoryEntry(manifest, entry, now);
    }
    expect(manifest.entries).toHaveLength(TRADE_HISTORY_LIMITS.entries);
    validateTradeHistoryManifest(manifest);
  });
});

function entryFor(value: OrderDto, observedAt = now) {
  return tradeHistoryEntryFromOrder(
    {
      slotId,
      robotName: "History Robot",
      robotHashId: "robot-hash",
      coordinatorShortAlias: "lake",
      order: value,
      observedAt
    },
    deviceId
  );
}

function order(overrides: Partial<OrderDto> = {}): OrderDto {
  return {
    id: 42,
    status: 14,
    type: 0,
    amount: 100,
    currency: 1,
    payment_method: "SEPA",
    premium: 1,
    satoshis: 200_000,
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
