import { describe, expect, it } from "vitest";
import type { OrderDto } from "@/domains/orders/order.types";
import { toProTradePresentation } from "@/domains/pro/proPresentation";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";

describe("PRO trade presentation", () => {
  it("keeps amount ranges visible and derives the local role", () => {
    const presentation = toProTradePresentation(snapshot({
      type: 0,
      has_range: true,
      min_amount: 25,
      max_amount: 100,
      is_maker: false,
      is_taker: true,
      payment_method: "Revolut"
    }));

    expect(presentation.amountLabel).toBe("25 - 100 USD");
    expect(presentation.directionLabel).toBe("Sell BTC");
    expect(presentation.methodLabel).toBe("Revolut");
  });

  it("marks an expired maker offer as renewable", () => {
    const presentation = toProTradePresentation(snapshot({ status: 5, is_maker: true, is_taker: false }));
    expect(presentation.group).toBe("renewable");
    expect(presentation.statusLabel).toBe("The order has expired");
  });

  it("retains the last status while clearly marking stale data", () => {
    const value = snapshot({ status: 9 });
    value.freshness = "error";
    const presentation = toProTradePresentation(value);
    expect(presentation.statusLabel).toBe("Chat with the buyer · Stale");
    expect(presentation.statusTone).toBe("muted");
  });
});

function snapshot(overrides: Partial<OrderDto>): ProTradeSnapshot {
  const order: OrderDto = {
    id: 42,
    status: 9,
    type: 0,
    amount: 50,
    currency: 1,
    payment_method: "SEPA",
    premium: 0,
    satoshis: 1000,
    is_maker: false,
    is_taker: true,
    is_buyer: false,
    is_seller: true,
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
  return {
    key: "slot:lake:42",
    locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
    nickname: "Robot",
    hashId: "hash",
    order,
    renewable: order.status === 5 && order.is_maker,
    released: false,
    freshness: "fresh",
    updatedAt: 1,
    changedAt: 1
  };
}
