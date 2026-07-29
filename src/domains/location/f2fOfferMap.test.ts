import { describe, expect, it } from "vitest";
import { groupCashF2FOffers, selectCashF2FOffers } from "@/domains/location/f2fOfferMap";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

function order(overrides: Partial<PublicOrder>): PublicOrder {
  return {
    id: 1,
    type: 0,
    currency: 1,
    amount: 100,
    has_range: false,
    is_swap: false,
    min_amount: 0,
    max_amount: 0,
    payment_method: "Cash F2F",
    premium: 0,
    satoshis: 100_000,
    maker_nick: "Robot",
    maker_hash_id: "hash",
    bond_size_sats: 0,
    coordinatorShortAlias: "alpha",
    ...overrides
  };
}

describe("Cash F2F offer map", () => {
  it("keeps every cash F2F offer, including legacy offers without coordinates", () => {
    const offers = selectCashF2FOffers([
      order({ id: 1, latitude: 35.7, longitude: 139.7 }),
      order({ id: 2, latitude: undefined, longitude: undefined }),
      order({ id: 3, payment_method: "CashApp" }),
      order({ id: 4, is_swap: true })
    ]);

    expect(offers.map((item) => item.id)).toEqual([1, 2]);
  });

  it("groups offers sharing the same approximate public area", () => {
    const groups = groupCashF2FOffers([
      order({ id: 1, latitude: 35.69, longitude: 139.69 }),
      order({ id: 2, latitude: 35.71, longitude: 139.71 }),
      order({ id: 3, latitude: 40.7, longitude: -74 })
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].orders.map((item) => item.id)).toEqual([1, 2]);
    expect(groups[0]).toMatchObject({ latitude: 35.7, longitude: 139.7 });
  });
});
