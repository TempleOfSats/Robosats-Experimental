import { describe, expect, it } from "vitest";
import type { OrderDto } from "@/domains/orders/order.types";
import { classifyProTrade, compareProTrades } from "@/domains/pro/proSelectors";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";

describe("PRO trade selectors", () => {
  it("puts actionable work before waiting and stale trades", () => {
    const action = snapshot({ status: 6, is_buyer: true, is_seller: false });
    const waiting = snapshot({ id: 2, status: 1, is_maker: true });
    const stale = { ...snapshot({ id: 3, status: 9 }), freshness: "error" as const };

    expect(classifyProTrade(action)).toBe("needs-action");
    expect(classifyProTrade(waiting)).toBe("waiting");
    expect(classifyProTrade(stale)).toBe("stale");
    expect([stale, waiting, action].sort(compareProTrades).map((item) => item.locator.orderId)).toEqual([1, 2, 3]);
  });

  it("classifies renewable maker offers independently", () => {
    expect(classifyProTrade({ ...snapshot({ status: 5, is_maker: true }), renewable: true })).toBe("renewable");
  });
});

function snapshot(overrides: Partial<OrderDto> = {}): ProTradeSnapshot {
  const order = {
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
  } satisfies OrderDto;
  return {
    key: `slot:lake:${order.id}`,
    locator: { slotId: "slot", shortAlias: "lake", orderId: order.id },
    nickname: "Robot",
    hashId: "hash",
    order,
    renewable: false,
    released: false,
    freshness: "fresh",
    updatedAt: 1,
    changedAt: 1
  };
}
