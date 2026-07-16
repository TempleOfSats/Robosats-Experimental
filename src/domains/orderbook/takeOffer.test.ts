import { describe, expect, it } from "vitest";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { buildTakeOfferPayload, defaultTakeAmount, validateTakeOffer } from "@/domains/orderbook/takeOffer";
import { sha256 } from "js-sha256";

const baseOrder: PublicOrder = {
  id: 101,
  type: 1,
  currency: 840,
  amount: 100,
  has_range: false,
  is_swap: false,
  min_amount: 0,
  max_amount: 0,
  payment_method: "Revolut",
  premium: 1,
  satoshis: 150000,
  maker_nick: "WorthyRansom407",
  maker_hash_id: "abc",
  bond_size_sats: 4500,
  coordinatorShortAlias: "robosats"
};

describe("takeOffer", () => {
  it("builds the fixed-amount current take payload without amount", () => {
    expect(buildTakeOfferPayload(baseOrder, "100", " secret ")).toEqual({
      action: "take",
      password: sha256("secret")
    });
  });

  it("builds the range-order take payload with selected fiat amount", () => {
    const order = { ...baseOrder, has_range: true, min_amount: 50, max_amount: 150 };
    expect(buildTakeOfferPayload(order, "75", "")).toEqual({
      action: "take",
      amount: 75,
      password: undefined
    });
  });

  it("requires an explicit amount for range orders", () => {
    expect(defaultTakeAmount({ ...baseOrder, has_range: true, min_amount: 25, max_amount: 125 })).toBe("");
  });

  it("validates range order boundaries", () => {
    const order = { ...baseOrder, has_range: true, min_amount: 50, max_amount: 150 };
    expect(validateTakeOffer(order, "49")).toEqual(["Amount must be between 50 and 150."]);
    expect(validateTakeOffer(order, "151")).toEqual(["Amount must be between 50 and 150."]);
    expect(validateTakeOffer(order, "100")).toEqual([]);
  });

  it("accepts swap range amounts in the BTC unit shown by the order", () => {
    const order = { ...baseOrder, currency: 1000, has_range: true, min_amount: 0.01, max_amount: 0.059 };
    expect(buildTakeOfferPayload(order, "0.02", "")).toMatchObject({ amount: 0.02 });
    expect(validateTakeOffer(order, "0.02")).toEqual([]);
  });
});
