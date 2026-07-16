import { describe, expect, it } from "vitest";
import { getTradeActionCommands } from "@/domains/orders/orderActions";
import { getTradeViewState } from "@/domains/orders/orderStateMachine";
import type { OrderDto } from "@/domains/orders/order.types";

const baseOrder: OrderDto = {
  id: 1,
  status: 1,
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
  taker_nick: "Taker",
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

describe("getTradeActionCommands", () => {
  it("matches the current maker early cancel_status payload", () => {
    const view = getTradeViewState(baseOrder);
    const cancel = getTradeActionCommands(baseOrder, view).find((action) => action.key === "cancel");
    expect(cancel?.payload).toEqual({ action: "cancel", cancel_status: 1 });
  });

  it("shows fiat sent confirmation for buyer in chat status 9", () => {
    const order = { ...baseOrder, status: 9, is_buyer: true, is_seller: false, is_maker: false };
    expect(getTradeActionCommands(order, getTradeViewState(order)).map((action) => action.payload)).toContainEqual({
      action: "confirm"
    });
  });

  it("does not duplicate the payout form as a disabled action", () => {
    const order = { ...baseOrder, status: 8, is_buyer: true, is_seller: false };
    const submit = getTradeActionCommands(order, getTradeViewState(order)).find((action) => action.key === "submit-payout");
    expect(submit).toBeUndefined();
  });

  it("does not duplicate dispute and rating forms as disabled actions", () => {
    const disputeOrder = { ...baseOrder, status: 11 };
    const ratingOrder = { ...baseOrder, status: 14 };

    expect(getTradeActionCommands(disputeOrder, getTradeViewState(disputeOrder)).find((action) => action.key === "submit-statement")).toBeUndefined();
    expect(getTradeActionCommands(ratingOrder, getTradeViewState(ratingOrder)).find((action) => action.key === "rate-platform")).toBeUndefined();
  });

  it("matches current cancellation availability", () => {
    const keys = (order: OrderDto) => getTradeActionCommands(order, getTradeViewState(order)).map((action) => action.key);
    expect(keys({ ...baseOrder, status: 6 })).toContain("cancel");
    expect(keys({ ...baseOrder, status: 7 })).toContain("cancel");
    expect(keys({ ...baseOrder, status: 9 })).toContain("collaborative-cancel");
    expect(keys({ ...baseOrder, status: 10 })).not.toContain("cancel");
  });

  it("labels a peer cancellation request as acceptance", () => {
    const order = { ...baseOrder, status: 9, pending_cancel: true };
    expect(getTradeActionCommands(order, getTradeViewState(order)).find((action) => action.key === "collaborative-cancel")?.label).toBe(
      "Accept cancellation"
    );
  });

  it("sends the current collaborative cancellation payload without cancel_status for both peers", () => {
    for (const pending_cancel of [false, true]) {
      const order = { ...baseOrder, status: 9, pending_cancel };
      const action = getTradeActionCommands(order, getTradeViewState(order)).find((item) => item.key === "collaborative-cancel");
      expect(action?.payload).toEqual({ action: "cancel", cancel_status: undefined });
    }
  });
});
