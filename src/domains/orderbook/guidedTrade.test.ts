import { describe, expect, it } from "vitest";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import {
  findGuidedTradeMatches,
  guidedCurrencyCodes,
  guidedPaymentMethods,
  guidedTradeMatches
} from "@/domains/orderbook/guidedTrade";

const baseOrder: PublicOrder = {
  id: 10,
  type: 1,
  currency: 1,
  currencyCode: "USD",
  amount: null,
  has_range: true,
  is_swap: false,
  min_amount: 50,
  max_amount: 250,
  payment_method: "Revolut Instant SEPA",
  premium: 2,
  satoshis: 0,
  maker_nick: "Maker",
  maker_hash_id: "hash",
  bond_size_sats: 1000,
  coordinatorShortAlias: "temple",
  expires_at: "2030-01-01T00:00:00Z"
};

describe("guidedTradeMatches", () => {
  it("requires a compatible side, currency, amount and payment method", () => {
    expect(guidedTradeMatches(baseOrder, {
      intent: "buy",
      currency: "USD",
      amount: 100,
      paymentMethod: "Revolut"
    }, Date.parse("2029-01-01T00:00:00Z"))).toBe(true);

    expect(guidedTradeMatches(baseOrder, {
      intent: "sell",
      currency: "USD",
      amount: 100,
      paymentMethod: "Revolut"
    }, Date.parse("2029-01-01T00:00:00Z"))).toBe(false);

    expect(guidedTradeMatches(baseOrder, {
      intent: "buy",
      currency: "EUR",
      amount: 100,
      paymentMethod: "Revolut"
    }, Date.parse("2029-01-01T00:00:00Z"))).toBe(false);

    expect(guidedTradeMatches(baseOrder, {
      intent: "buy",
      currency: "USD",
      amount: 300,
      paymentMethod: "Revolut"
    }, Date.parse("2029-01-01T00:00:00Z"))).toBe(false);
  });

  it("excludes private, swap and expired offers", () => {
    const criteria = { intent: "buy" as const, currency: "USD", amount: 100, paymentMethod: "Revolut" };
    expect(guidedTradeMatches({ ...baseOrder, has_password: true }, criteria, Date.parse("2029-01-01T00:00:00Z"))).toBe(false);
    expect(guidedTradeMatches({ ...baseOrder, is_swap: true }, criteria, Date.parse("2029-01-01T00:00:00Z"))).toBe(false);
    expect(guidedTradeMatches(baseOrder, criteria, Date.parse("2031-01-01T00:00:00Z"))).toBe(false);
    expect(guidedTradeMatches({ ...baseOrder, expires_at: "invalid" }, criteria, Date.parse("2029-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("findGuidedTradeMatches", () => {
  it("puts the best buyer price first", () => {
    const matches = findGuidedTradeMatches([
      { ...baseOrder, id: 1, premium: 4 },
      { ...baseOrder, id: 2, premium: -1 },
      { ...baseOrder, id: 3, premium: 1 }
    ], {
      intent: "buy",
      currency: "USD",
      amount: 100,
      paymentMethod: "Revolut"
    }, Date.parse("2029-01-01T00:00:00Z"));

    expect(matches.map((order) => order.id)).toEqual([2, 3, 1]);
  });

  it("puts the best seller price first", () => {
    const sellOrder = { ...baseOrder, type: 0 };
    const matches = findGuidedTradeMatches([
      { ...sellOrder, id: 1, premium: 4 },
      { ...sellOrder, id: 2, premium: -1 },
      { ...sellOrder, id: 3, premium: 1 }
    ], {
      intent: "sell",
      currency: "USD",
      amount: 100,
      paymentMethod: "Revolut"
    }, Date.parse("2029-01-01T00:00:00Z"));

    expect(matches.map((order) => order.id)).toEqual([1, 3, 2]);
  });
});

describe("guided suggestions", () => {
  it("prioritizes currencies and methods represented by compatible offers", () => {
    const orders = [
      baseOrder,
      { ...baseOrder, id: 11, currency: 2, currencyCode: "EUR", payment_method: "Wise" },
      { ...baseOrder, id: 12, payment_method: "Revolut" }
    ];

    expect(guidedCurrencyCodes(orders, "buy", Date.parse("2029-01-01T00:00:00Z"))).toEqual(["USD", "EUR"]);
    expect(guidedPaymentMethods(
      orders,
      { intent: "buy", currency: "USD", amount: 100 },
      Date.parse("2029-01-01T00:00:00Z")
    )).toEqual([
      "Revolut",
      "Instant SEPA"
    ]);
  });

  it("does not suggest choices from expired offers", () => {
    const expiredOrder = { ...baseOrder, expires_at: "2028-01-01T00:00:00Z" };
    const now = Date.parse("2029-01-01T00:00:00Z");

    expect(guidedCurrencyCodes([expiredOrder], "buy", now)).toEqual([]);
    expect(guidedPaymentMethods(
      [expiredOrder],
      { intent: "buy", currency: "USD", amount: 100 },
      now
    )).toEqual([]);
  });
});
