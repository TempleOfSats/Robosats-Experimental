import { describe, expect, it } from "vitest";
import {
  isOrderReferenceSatsApproximate,
  normalizeOrderDto,
  orderReferenceSats,
  orderReferenceSatsRange
} from "@/domains/orders/orderModel";

describe("normalizeOrderDto", () => {
  it("normalizes null and string numeric fields from private order responses", () => {
    expect(
      normalizeOrderDto({
        id: "89895",
        status: "6",
        type: "1",
        amount: "1360.5",
        currency: "986",
        premium: "0",
        satoshis: null,
        bond_satoshis: "12578",
        escrow_satoshis: null,
        invoice_amount: "418137",
        swap_allowed: "true",
        suggested_mining_fee_rate: "2.5",
        swap_fee_rate: "1.25",
        is_maker: "false",
        is_taker: "true",
        is_buyer: 1,
        is_seller: 0,
        payment_method: "Pix",
        maker_nick: "WorthyRansom407",
        taker_nick: "HelpfulVeranda735"
      })
    ).toMatchObject({
      id: 89895,
      status: 6,
      type: 1,
      amount: 1360.5,
      currency: 986,
      premium: 0,
      satoshis: 0,
      bond_satoshis: 12578,
      escrow_satoshis: 0,
      invoice_amount: 418137,
      swap_allowed: true,
      suggested_mining_fee_rate: 2.5,
      swap_fee_rate: 1.25,
      is_maker: false,
      is_taker: true,
      is_buyer: true,
      is_seller: false,
      payment_method: "Pix",
      maker_nick: "WorthyRansom407",
      taker_nick: "HelpfulVeranda735"
    });
  });

  it("keeps backend validation messages", () => {
    expect(normalizeOrderDto({ bad_request: "Order has expired" }).bad_request).toBe("Order has expired");
  });

  it("recovers the pre-take trade estimate from the generated bond", () => {
    const order = normalizeOrderDto({
      status: "3",
      satoshis: null,
      satoshis_now: null,
      trade_satoshis: null,
      invoice_amount: null,
      escrow_satoshis: null,
      bond_satoshis: "4468",
      bond_size: "3"
    });

    expect(order.bond_size).toBe(3);
    expect(orderReferenceSats(order)).toBe(148933);
    expect(isOrderReferenceSatsApproximate(order)).toBe(true);
  });

  it("prefers exact pipeline amounts over the bond-derived estimate", () => {
    const order = normalizeOrderDto({
      trade_satoshis: "148120",
      bond_satoshis: "4468",
      bond_size: "3"
    });

    expect(orderReferenceSats(order)).toBe(148120);
    expect(isOrderReferenceSatsApproximate(order)).toBe(false);
  });

  it("prefers the selected range amount over the order's static maximum", () => {
    const order = normalizeOrderDto({ satoshis: "300000", satoshis_now: "148933" });
    expect(orderReferenceSats(order)).toBe(148933);
  });

  it("scales an unselected range from the maximum satoshi quote", () => {
    const order = normalizeOrderDto({
      amount: null,
      has_range: true,
      min_amount: "10",
      max_amount: "45",
      satoshis_now: "69768"
    });

    expect(orderReferenceSatsRange(order)).toEqual({ minimum: 15504, maximum: 69768 });
  });

  it("does not show a satoshi range after the taker selects an amount", () => {
    const order = normalizeOrderDto({
      amount: "20",
      has_range: true,
      min_amount: "10",
      max_amount: "45",
      satoshis_now: "31008"
    });

    expect(orderReferenceSatsRange(order)).toBeUndefined();
  });

  it("keeps private pipeline flags returned by RoboSats", () => {
    expect(
      normalizeOrderDto({
        status_message: "In dispute",
        escrow_duration: "10800",
        statement_submitted: "true",
        pending_cancel: 1,
        trade_satoshis: "418137",
        retries: "2",
        invoice_expired: true,
        failure_reason: "No route",
        next_retry_time: "2026-07-12T12:00:00Z"
      })
    ).toMatchObject({
      status_message: "In dispute",
      escrow_duration: 10800,
      statement_submitted: true,
      pending_cancel: true,
      trade_satoshis: 418137,
      retries: 2,
      invoice_expired: true,
      failure_reason: "No route",
      next_retry_time: "2026-07-12T12:00:00Z"
    });
  });
});
