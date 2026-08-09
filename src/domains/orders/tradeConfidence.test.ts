import { describe, expect, it } from "vitest";
import { getTradeViewState } from "@/domains/orders/orderStateMachine";
import { shouldShowFinishedReceipt, tradeFiatText, tradeSatsText } from "@/domains/orders/tradeConfidence";
import type { OrderDto } from "@/domains/orders/order.types";

describe("trade confidence presentation", () => {
  it("shows finished receipts only for role-final trade outcomes", () => {
    const success = tradeOrder({ status: 14 });
    const collaborative = tradeOrder({ status: 12 });
    const cancelled = tradeOrder({ status: 4, is_maker: true, is_taker: false });
    const won = tradeOrder({ status: 18, is_maker: true, is_taker: false });
    const routing = tradeOrder({ status: 13, is_buyer: true, is_seller: false });
    const queued = tradeOrder({ status: 13, is_buyer: true, is_seller: false, tx_queued: true });

    expect(shouldShowFinishedReceipt(success, getTradeViewState(success))).toBe(true);
    expect(shouldShowFinishedReceipt(collaborative, getTradeViewState(collaborative))).toBe(true);
    expect(shouldShowFinishedReceipt(cancelled, getTradeViewState(cancelled))).toBe(true);
    expect(shouldShowFinishedReceipt(won, getTradeViewState(won))).toBe(true);
    expect(shouldShowFinishedReceipt(routing, getTradeViewState(routing))).toBe(false);
    expect(shouldShowFinishedReceipt(queued, getTradeViewState(queued))).toBe(false);
  });

  it("omits unavailable amounts instead of formatting them as zero", () => {
    const order = tradeOrder({ amount: null, invoice_amount: 0, trade_satoshis: 0, satoshis: 0 });

    expect(tradeFiatText(order)).toBeUndefined();
    expect(tradeSatsText(order)).toBeUndefined();
  });
});

function tradeOrder(overrides: Partial<OrderDto> = {}): OrderDto {
  return {
    id: 92195,
    status: 9,
    type: 1,
    amount: 12,
    currency: 1,
    payment_method: "Revolut",
    premium: 0,
    satoshis: 18_826,
    trade_satoshis: 18_826,
    is_maker: false,
    is_taker: true,
    is_buyer: true,
    is_seller: false,
    maker_nick: "Seller",
    maker_hash_id: "seller-hash",
    taker_nick: "ThoroughYes-man38",
    taker_hash_id: "buyer-hash",
    bond_invoice: "",
    bond_satoshis: 500,
    escrow_invoice: "",
    escrow_satoshis: 18_826,
    invoice_amount: 18_826,
    swap_allowed: false,
    suggested_mining_fee_rate: 0,
    swap_fee_rate: 0,
    expires_at: "2026-08-08T18:00:00Z",
    shortAlias: "temple",
    ...overrides
  };
}
