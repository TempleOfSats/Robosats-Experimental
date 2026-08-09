import { describe, expect, it } from "vitest";
import { getTradeActionCommands, shouldLeaveTradeAfterAction } from "@/domains/orders/orderActions";
import { getTradeViewState } from "@/domains/orders/orderStateMachine";
import type { OrderDto } from "@/domains/orders/order.types";

const baseOrder: OrderDto = {
  id: 1,
  status: 1,
  type: 0,
  amount: 100,
  currency: 1,
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

  it("explains that a public maker cancellation returns the bond without penalty", () => {
    const action = getTradeActionCommands(baseOrder, getTradeViewState(baseOrder)).find(
      (item) => item.key === "cancel"
    );

    expect(action?.confirmation).toMatchObject({
      consequence: "Because no taker has joined, your maker bond will be returned without penalty.",
      primaryLabel: "Cancel order"
    });
  });

  it("shows fiat sent confirmation for buyer in chat status 9", () => {
    const order = { ...baseOrder, status: 9, is_buyer: true, is_seller: false, is_maker: false };
    const confirmation = getTradeActionCommands(order, getTradeViewState(order)).find(
      (action) => action.key === "confirm-fiat-sent"
    );

    expect(confirmation).toMatchObject({
      label: "Confirm 100 USD sent",
      payload: { action: "confirm" },
      confirmation: {
        title: "Confirm 100 USD sent?",
        instruction: "Continue only after the transfer has left your account."
      }
    });
    expect(confirmation?.confirmation?.instruction).not.toContain("Bank transfer");
  });

  it("does not duplicate the payout form as a disabled action", () => {
    const order = { ...baseOrder, status: 8, is_buyer: true, is_seller: false };
    const submit = getTradeActionCommands(order, getTradeViewState(order)).find(
      (action) => action.key === "submit-payout"
    );
    expect(submit).toBeUndefined();
  });

  it("does not duplicate dispute and rating forms as disabled actions", () => {
    const disputeOrder = { ...baseOrder, status: 11 };
    const ratingOrder = { ...baseOrder, status: 14 };

    expect(
      getTradeActionCommands(disputeOrder, getTradeViewState(disputeOrder)).find(
        (action) => action.key === "submit-statement"
      )
    ).toBeUndefined();
    expect(
      getTradeActionCommands(ratingOrder, getTradeViewState(ratingOrder)).find(
        (action) => action.key === "rate-platform"
      )
    ).toBeUndefined();
  });

  it("matches current cancellation availability", () => {
    const keys = (order: OrderDto) =>
      getTradeActionCommands(order, getTradeViewState(order)).map((action) => action.key);
    expect(keys({ ...baseOrder, status: 6 })).toContain("cancel");
    expect(keys({ ...baseOrder, status: 7 })).toContain("cancel");
    expect(keys({ ...baseOrder, status: 9 })).toContain("collaborative-cancel");
    expect(keys({ ...baseOrder, status: 10 })).not.toContain("cancel");
  });

  it("labels a peer cancellation request as acceptance", () => {
    const order = { ...baseOrder, status: 9, pending_cancel: true };
    expect(
      getTradeActionCommands(order, getTradeViewState(order)).find((action) => action.key === "collaborative-cancel")
        ?.label
    ).toBe("Accept cancellation");
  });

  it("sends the current collaborative cancellation payload without cancel_status for both peers", () => {
    for (const pending_cancel of [false, true]) {
      const order = { ...baseOrder, status: 9, pending_cancel };
      const action = getTradeActionCommands(order, getTradeViewState(order)).find(
        (item) => item.key === "collaborative-cancel"
      );
      expect(action?.payload).toEqual({ action: "cancel", cancel_status: undefined });
    }
  });

  it("owns confirmation, placement, ordering and post-success semantics", () => {
    const order = { ...baseOrder, status: 9, is_buyer: true, is_seller: false, is_maker: false };
    const commands = getTradeActionCommands(order, getTradeViewState(order));

    expect(
      commands.map((command) => ({
        key: command.key,
        displayOrder: command.displayOrder,
        placement: command.placement,
        postSuccess: command.postSuccess,
        requiresConfirmation: Boolean(command.confirmation)
      }))
    ).toEqual([
      {
        key: "collaborative-cancel",
        displayOrder: 1,
        placement: "options",
        postSuccess: "leave-if-order-inactive",
        requiresConfirmation: true
      },
      {
        key: "confirm-fiat-sent",
        displayOrder: 0,
        placement: "primary",
        postSuccess: "stay",
        requiresConfirmation: true
      },
      {
        key: "open-dispute",
        displayOrder: 2,
        placement: "options",
        postSuccess: "stay",
        requiresConfirmation: true
      }
    ]);
    expect(
      [...commands]
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .map(({ key, label, variant }) => ({ key, label, variant }))
    ).toEqual([
      {
        key: "confirm-fiat-sent",
        label: "Confirm 100 USD sent",
        variant: "primary"
      },
      {
        key: "collaborative-cancel",
        label: "Collaborative cancel",
        variant: "secondary"
      },
      {
        key: "open-dispute",
        label: "Open dispute",
        variant: "outline"
      }
    ]);
  });

  it("keeps pause direct and ordered with the existing trade options", () => {
    const commands = getTradeActionCommands(baseOrder, getTradeViewState(baseOrder));

    expect(
      commands.map((command) => ({
        key: command.key,
        displayOrder: command.displayOrder,
        placement: command.placement,
        requiresConfirmation: Boolean(command.confirmation)
      }))
    ).toEqual([
      {
        key: "cancel",
        displayOrder: 1,
        placement: "options",
        requiresConfirmation: true
      },
      {
        key: "pause",
        displayOrder: 1,
        placement: "options",
        requiresConfirmation: false
      }
    ]);
    expect(
      [...commands].sort((left, right) => left.displayOrder - right.displayOrder).map((command) => command.key)
    ).toEqual(["cancel", "pause"]);
  });

  it("describes the seller release with a real verb, verification step and irreversible consequence", () => {
    const order = {
      ...baseOrder,
      status: 10,
      amount: 12,
      currency: 1,
      payment_method: "Revolut",
      escrow_satoshis: 18_826,
      trade_satoshis: 18_826,
      is_buyer: false,
      is_seller: true
    };
    const release = getTradeActionCommands(order, getTradeViewState(order)).find(
      (action) => action.key === "confirm-fiat-received"
    );

    expect(release?.confirmation).toEqual({
      title: "Confirm 12 USD was received",
      instruction: "Check your account balance, not a screenshot or pending notification, before continuing.",
      consequence: "18,826 sats will be released to the buyer. This cannot be undone after the coordinator accepts it.",
      primaryLabel: "Release 18,826 sats",
      submittingLabel: "Releasing bitcoin",
      tone: "attention"
    });
    expect(release?.label).toBe("Confirm 12 USD received");
  });

  it("makes unilateral setup cancellation explicitly acknowledge bond risk", () => {
    const order = { ...baseOrder, status: 7 };
    const cancellation = getTradeActionCommands(order, getTradeViewState(order)).find(
      (action) => action.key === "cancel"
    );

    expect(cancellation?.confirmation).toMatchObject({
      title: "Cancel and accept the risk?",
      primaryLabel: "Cancel and accept risk",
      tone: "danger"
    });
  });
});

describe("shouldLeaveTradeAfterAction", () => {
  const cancellation = {
    postSuccess: "leave-if-order-inactive"
  } as const;
  const stay = {
    postSuccess: "stay"
  } as const;

  it("keeps the first peer in chat while collaborative cancellation awaits acceptance", () => {
    expect(
      shouldLeaveTradeAfterAction(cancellation, {
        status: 9,
        is_maker: false,
        is_taker: true
      })
    ).toBe(false);
  });

  it("leaves after terminal cancellation or an early take is released", () => {
    expect(
      shouldLeaveTradeAfterAction(cancellation, {
        status: 12,
        is_maker: false,
        is_taker: true
      })
    ).toBe(true);
    expect(
      shouldLeaveTradeAfterAction(cancellation, {
        status: 4,
        is_maker: false,
        is_taker: false
      })
    ).toBe(true);
    expect(
      shouldLeaveTradeAfterAction(cancellation, {
        status: 1,
        is_maker: false,
        is_taker: false
      })
    ).toBe(true);
  });

  it("never navigates for commands that remain in the trade", () => {
    expect(
      shouldLeaveTradeAfterAction(stay, {
        status: 4,
        is_maker: false,
        is_taker: false
      })
    ).toBe(false);
  });
});
