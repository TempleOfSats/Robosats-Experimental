import { describe, expect, it } from "vitest";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { activePublicOrders, coordinatorFilterOptions, filterPublicOrders } from "@/domains/orderbook/orderbookFilters";

const orders: PublicOrder[] = [
  order({ id: 1, type: 0, currency: 2, currencyCode: "EUR", payment_method: "Wise", coordinatorShortAlias: "lake" }),
  order({ id: 2, type: 1, currency: 20, currencyCode: "BRL", payment_method: "PIX", coordinatorShortAlias: "temple" }),
  order({ id: 3, type: 1, currency: 1, currencyCode: "USD", payment_method: "Zelle", coordinatorShortAlias: "lake" })
];

describe("filterPublicOrders", () => {
  it("filters by side and coordinator together", () => {
    expect(filterPublicOrders(orders, { side: "sell", coordinator: "lake" }).map((item) => item.id)).toEqual([1]);
  });
});

describe("activePublicOrders", () => {
  it("removes expired offers while preserving active, undated, and malformed legacy offers", () => {
    const now = Date.parse("2026-08-08T12:00:00.000Z");
    const candidates = [
      order({ id: 10, expires_at: "2026-08-08T11:59:59.000Z" }),
      order({ id: 11, expires_at: "2026-08-08T12:00:00.000Z" }),
      order({ id: 12, expires_at: "2026-08-08T12:00:01.000Z" }),
      order({ id: 13 }),
      order({ id: 14, expires_at: "not-a-date" })
    ];

    expect(activePublicOrders(candidates, now).map((candidate) => candidate.id)).toEqual([12, 13, 14]);
  });
});

describe("coordinatorFilterOptions", () => {
  it("returns sorted unique coordinator aliases from visible orders", () => {
    expect(coordinatorFilterOptions(orders)).toEqual(["lake", "temple"]);
  });
});

function order(overrides: Partial<PublicOrder>): PublicOrder {
  return {
    id: 0,
    type: 0,
    currency: 1,
    currencyCode: "USD",
    amount: 100,
    has_range: false,
    is_swap: false,
    min_amount: 0,
    max_amount: 0,
    payment_method: "Wise",
    premium: 0,
    satoshis: 0,
    maker_nick: "HelpfulVeranda735",
    maker_hash_id: "maker-hash",
    bond_size_sats: 0,
    coordinatorShortAlias: "lake",
    ...overrides
  };
}
