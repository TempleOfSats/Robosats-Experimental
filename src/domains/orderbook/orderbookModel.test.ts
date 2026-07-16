import { describe, expect, it } from "vitest";
import { normalizePublicOrder } from "@/domains/orderbook/orderbookModel";

describe("normalizePublicOrder", () => {
  it("normalizes numeric strings returned by coordinator book APIs", () => {
    expect(
      normalizePublicOrder({
        id: "42",
        created_at: "2026-07-06T08:00:00Z",
        expires_at: "2026-07-07T08:00:00Z",
        type: "1",
        currency: "840",
        amount: "100.5",
        has_range: "false",
        is_swap: "true",
        min_amount: "0",
        max_amount: "0",
        payment_method: "Revolut",
        description: "Meet beside the station entrance.",
        premium: "1.25",
        satoshis: "150000",
        satoshis_now: "149900",
        maker_nick: "HelpfulVeranda735",
        maker_hash_id: "abc",
        bond_size_sats: "4500",
        coordinatorShortAlias: "local"
      })
    ).toEqual({
      id: 42,
      created_at: "2026-07-06T08:00:00Z",
      expires_at: "2026-07-07T08:00:00Z",
      type: 1,
      currency: 840,
      amount: 100.5,
      has_range: false,
      is_swap: true,
      min_amount: 0,
      max_amount: 0,
      payment_method: "Revolut",
      description: "Meet beside the station entrance.",
      premium: 1.25,
      satoshis: 150000,
      satoshis_now: 149900,
      maker_nick: "HelpfulVeranda735",
      maker_hash_id: "abc",
      bond_size_sats: 4500,
      coordinatorShortAlias: "local"
    });
  });

  it("keeps null amount and supports string booleans for range orders", () => {
    const order = normalizePublicOrder({
      amount: null,
      has_range: "true",
      min_amount: "50",
      max_amount: "150"
    });

    expect(order.amount).toBeNull();
    expect(order.has_range).toBe(true);
    expect(order.min_amount).toBe(50);
    expect(order.max_amount).toBe(150);
  });

  it("infers swap orders from BTC currency when the coordinator omits is_swap", () => {
    expect(normalizePublicOrder({ currency: "1000", payment_method: "On-Chain BTC" }).is_swap).toBe(true);
    expect(normalizePublicOrder({ currencyCode: "BTC" }).is_swap).toBe(true);
  });

  it("omits an empty order description", () => {
    expect(normalizePublicOrder({ description: "   " }).description).toBeUndefined();
  });
});
