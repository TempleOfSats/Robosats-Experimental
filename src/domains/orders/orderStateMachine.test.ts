import { describe, expect, it } from "vitest";
import { getTradeViewState } from "@/domains/orders/orderStateMachine";
import type { OrderDto } from "@/domains/orders/order.types";

const baseOrder: OrderDto = {
  id: 1,
  status: 0,
  type: 0,
  amount: 100,
  currency: 840,
  payment_method: "Bank transfer",
  premium: 0,
  satoshis: 10000,
  is_maker: true,
  is_taker: false,
  is_buyer: false,
  is_seller: true,
  maker_nick: "Maker",
  maker_hash_id: "",
  taker_nick: "",
  taker_hash_id: "",
  bond_invoice: "",
  bond_satoshis: 300,
  escrow_invoice: "",
  escrow_satoshis: 10000,
  invoice_amount: 10000,
  swap_allowed: false,
  suggested_mining_fee_rate: 0,
  swap_fee_rate: 0,
  expires_at: new Date().toISOString(),
  shortAlias: "local"
};

describe("getTradeViewState", () => {
  it("requires maker bond on status 0 for maker", () => {
    expect(getTradeViewState(baseOrder)).toMatchObject({
      requiredAction: "pay_bond",
      bondStatus: "hide"
    });
  });

  it("requires buyer payout info on status 6", () => {
    expect(
      getTradeViewState({
        ...baseOrder,
        status: 6,
        is_buyer: true,
        is_seller: false
      })
    ).toMatchObject({
      requiredAction: "submit_payout",
      title: "Submit payout info"
    });
  });

  it("maps successful trade to rating action", () => {
    expect(getTradeViewState({ ...baseOrder, status: 14 })).toMatchObject({
      tone: "success",
      requiredAction: "rate",
      panel: "success"
    });
  });

  it("preserves buyer and seller setup branches", () => {
    expect(getTradeViewState({ ...baseOrder, status: 7, is_buyer: true, is_seller: false }).panel).toBe("escrow_wait");
    expect(getTradeViewState({ ...baseOrder, status: 7, is_buyer: false, is_seller: true }).panel).toBe("escrow_invoice");
    expect(getTradeViewState({ ...baseOrder, status: 8, is_buyer: true, is_seller: false }).panel).toBe("payout");
    expect(getTradeViewState({ ...baseOrder, status: 8, is_buyer: false, is_seller: true }).panel).toBe("payout_wait");
  });

  it("waits after a dispute statement has already been submitted", () => {
    expect(getTradeViewState({ ...baseOrder, status: 11, statement_submitted: false }).panel).toBe("dispute_statement");
    expect(getTradeViewState({ ...baseOrder, status: 11, statement_submitted: true })).toMatchObject({
      panel: "dispute_peer_wait",
      requiredAction: "wait"
    });
  });

  it("shows sellers a completed trade while the buyer payout resolves", () => {
    expect(getTradeViewState({ ...baseOrder, status: 13, is_buyer: false, is_seller: true }).panel).toBe("success");
    expect(getTradeViewState({ ...baseOrder, status: 15, is_buyer: false, is_seller: true }).panel).toBe("success");
  });

  it("requests a replacement invoice only when the failed invoice expired", () => {
    const buyer = { ...baseOrder, status: 15, is_buyer: true, is_seller: false };
    expect(getTradeViewState({ ...buyer, invoice_expired: false }).requiredAction).toBe("wait");
    expect(getTradeViewState({ ...buyer, invoice_expired: true }).requiredAction).toBe("retry_invoice");
  });

  it("reserves the public-order owner message for the maker", () => {
    expect(getTradeViewState({ ...baseOrder, status: 1, is_maker: true, is_taker: false }).title).toBe("Your order is public");
    expect(getTradeViewState({ ...baseOrder, status: 1, is_maker: false, is_taker: false })).toMatchObject({
      title: "This order is public",
      panel: "wait"
    });
  });

  it("describes dispute results from the current robot perspective", () => {
    expect(getTradeViewState({ ...baseOrder, status: 17, is_maker: true, is_taker: false }).panel).toBe("dispute_lost");
    expect(getTradeViewState({ ...baseOrder, status: 17, is_maker: false, is_taker: true }).panel).toBe("dispute_won");
    expect(getTradeViewState({ ...baseOrder, status: 18, is_maker: true, is_taker: false }).panel).toBe("dispute_won");
    expect(getTradeViewState({ ...baseOrder, status: 18, is_maker: false, is_taker: true }).panel).toBe("dispute_lost");
  });

  it("covers every current order status with a panel and message", () => {
    for (let status = 0; status <= 18; status += 1) {
      const view = getTradeViewState({
        ...baseOrder,
        status,
        is_buyer: status === 6 || status === 8 || status === 15,
        is_seller: status === 7
      });

      expect(view.panel, `status ${status}`).toBeTruthy();
      expect(view.message.heading, `status ${status}`).toBeTruthy();
      expect(view.message.body, `status ${status}`).toBeTruthy();
      expect(view.message.next, `status ${status}`).toBeTruthy();
    }
  });
});
