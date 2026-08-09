import type { OrderDto, SubmitOrderActionPayload, TradeViewState } from "@/domains/orders/order.types";
import { tradeFiatText, tradeSatsText } from "@/domains/orders/tradeConfidence";

type TradeActionConfirmation = {
  title: string;
  instruction: string;
  consequence: string;
  primaryLabel: string;
  submittingLabel: string;
  tone: "attention" | "danger";
};

export type TradeActionCommand = {
  key: string;
  label: string;
  description: string;
  payload?: SubmitOrderActionPayload;
  variant: "primary" | "secondary" | "outline" | "destructive";
  disabledReason?: string;
  displayOrder: number;
  placement: "primary" | "options";
  postSuccess: "stay" | "leave-if-order-inactive";
  confirmation?: TradeActionConfirmation;
};

export function getTradeActionCommands(order: OrderDto, view: TradeViewState): TradeActionCommand[] {
  const actions: TradeActionCommand[] = [];
  const { fiat, sats } = tradeActionFacts(order);

  if (canCancel(order)) {
    const collaborative = order.status === 9;
    actions.push({
      key: collaborative ? "collaborative-cancel" : "cancel",
      label: collaborative ? (order.pending_cancel ? "Accept cancellation" : "Collaborative cancel") : "Cancel order",
      description: collaborative
        ? order.pending_cancel
          ? "Your peer requested cancellation. Accept only if you both agreed in chat; accepting ends the contract and unlocks funds according to its current state."
          : "Ask your peer to cancel this contract together. The trade continues until your peer accepts the request."
        : [6, 7].includes(order.status)
          ? "Unilateral cancellation at this stage can put your bond at risk."
          : "Cancel this order before the trade moves further.",
      payload: { action: "cancel", cancel_status: shouldSendCancelStatus(order) ? order.status : undefined },
      variant: collaborative ? "secondary" : "outline",
      displayOrder: 1,
      placement: "options",
      postSuccess: "leave-if-order-inactive",
      confirmation: cancellationConfirmation(order)
    });
  }

  if (order.is_maker && [1, 2].includes(order.status)) {
    actions.push({
      key: "pause",
      label: order.status === 2 ? "Resume order" : "Pause order",
      description: order.status === 2 ? "Make this order visible again." : "Hide this order from the public book.",
      payload: { action: "pause" },
      variant: "outline",
      displayOrder: 1,
      placement: "options",
      postSuccess: "stay"
    });
  }

  if (view.panel === "chat" && order.is_buyer && order.status === 9) {
    actions.push({
      key: "confirm-fiat-sent",
      label: `Confirm ${fiat} sent`,
      description: `Confirm only after you sent ${fiat}. This cannot be undone normally, and a false confirmation can cost your bond.`,
      payload: { action: "confirm" },
      variant: "primary",
      displayOrder: 0,
      placement: "primary",
      postSuccess: "stay",
      confirmation: {
        title: `Confirm ${fiat} sent?`,
        instruction: "Continue only after the transfer has left your account.",
        consequence: "This declaration cannot normally be undone, and a false confirmation can cost your bond.",
        primaryLabel: `${fiat} sent`,
        submittingLabel: "Marking fiat as sent",
        tone: "attention"
      }
    });
  }

  if (view.panel === "chat" && order.is_buyer && order.status === 10) {
    actions.push({
      key: "undo-confirm",
      label: "Undo fiat sent",
      description:
        "Use only when the fiat payment definitively failed, the funds are back in your account, and both peers already agreed in chat to collaborate on cancellation.",
      payload: { action: "undo_confirm" },
      variant: "outline",
      displayOrder: 0,
      placement: "primary",
      postSuccess: "stay",
      confirmation: {
        title: "Undo fiat sent?",
        instruction: "Continue only if the payment definitively failed and the funds are back in your account.",
        consequence: "This reverses your payment declaration. Agree with your peer in chat before using it.",
        primaryLabel: "Undo fiat sent",
        submittingLabel: "Undoing fiat sent",
        tone: "attention"
      }
    });
  }

  if (view.panel === "chat" && order.is_seller && order.status === 10) {
    actions.push({
      key: "confirm-fiat-received",
      label: `Confirm ${fiat} received`,
      description: `Confirm only after ${fiat} is visible in your account. This releases the bitcoin escrow to the buyer and cannot be undone.`,
      payload: { action: "confirm" },
      variant: "primary",
      displayOrder: 0,
      placement: "primary",
      postSuccess: "stay",
      confirmation: {
        title: `Confirm ${fiat} was received`,
        instruction: "Check your account balance, not a screenshot or pending notification, before continuing.",
        consequence: `${sats} will be released to the buyer. This cannot be undone after the coordinator accepts it.`,
        primaryLabel: `Release ${sats}`,
        submittingLabel: "Releasing bitcoin",
        tone: "attention"
      }
    });
  }

  if ([9, 10].includes(order.status)) {
    actions.push({
      key: "open-dispute",
      label: "Open dispute",
      description:
        "Open a dispute only when the peer is not cooperating. The coordinator cannot read this encrypted chat automatically, so preserve the messages and prepare a factual statement with evidence.",
      payload: { action: "dispute" },
      variant: "outline",
      disabledReason: disputeDisabledReason(order),
      displayOrder: 2,
      placement: "options",
      postSuccess: "stay",
      confirmation: {
        title: "Open a dispute?",
        instruction: "Use a dispute only when the peer is not cooperating, and preserve the relevant evidence.",
        consequence: "The coordinator cannot read encrypted chat automatically and will require a factual statement.",
        primaryLabel: "Open dispute",
        submittingLabel: "Opening dispute",
        tone: "attention"
      }
    });
  }

  return actions;
}

function tradeActionFacts(order: OrderDto) {
  return {
    fiat: tradeFiatText(order) ?? "the fiat payment",
    sats: tradeSatsText(order) ?? "the bitcoin escrow"
  };
}

export function shouldLeaveTradeAfterAction(
  action: Pick<TradeActionCommand, "postSuccess">,
  order?: Pick<OrderDto, "status" | "is_maker" | "is_taker">
): boolean {
  if (action.postSuccess !== "leave-if-order-inactive" || !order) return false;
  return [4, 12].includes(order.status) || (order.status === 1 && !order.is_maker && !order.is_taker);
}

function canCancel(order: OrderDto): boolean {
  return Boolean((order.is_maker && [0, 1, 2].includes(order.status)) || [3, 6, 7, 9].includes(order.status));
}

function shouldSendCancelStatus(order: OrderDto): boolean {
  return Boolean(order.is_maker && [0, 1, 2, 3].includes(order.status));
}

function disputeDisabledReason(order: OrderDto): string | undefined {
  const expiresAt = new Date(order.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return undefined;
  const enabledAt = expiresAt - 18 * 60 * 60 * 1000;
  if (Date.now() >= enabledAt) return undefined;
  return `Disputes become available at ${new Date(enabledAt).toLocaleString()}.`;
}

function cancellationConfirmation(order: OrderDto): TradeActionConfirmation {
  if (order.status === 9 && order.pending_cancel) {
    return {
      title: "Accept collaborative cancellation?",
      instruction: "Continue only if both robots already agreed to cancel in chat.",
      consequence: "This ends the contract and unlocks funds according to its current state.",
      primaryLabel: "Accept cancellation",
      submittingLabel: "Accepting cancellation",
      tone: "attention"
    };
  }
  if (order.status === 9) {
    return {
      title: "Request collaborative cancellation?",
      instruction: "Agree with your peer in chat before sending the request.",
      consequence: "The trade continues until your peer accepts the cancellation.",
      primaryLabel: "Request cancellation",
      submittingLabel: "Requesting cancellation",
      tone: "attention"
    };
  }
  if ([6, 7].includes(order.status)) {
    return {
      title: "Cancel and accept the risk?",
      instruction: "Continue only if this order cannot safely proceed.",
      consequence: "Unilateral cancellation at this stage can put your bond at risk.",
      primaryLabel: "Cancel and accept risk",
      submittingLabel: "Cancelling order",
      tone: "danger"
    };
  }
  if (order.is_maker && [1, 2].includes(order.status)) {
    return {
      title: "Cancel this order?",
      instruction: "Check that you no longer want this public offer.",
      consequence: "Because no taker has joined, your maker bond will be returned without penalty.",
      primaryLabel: "Cancel order",
      submittingLabel: "Cancelling order",
      tone: "attention"
    };
  }
  return {
    title: "Cancel this order?",
    instruction: "Check that you no longer want this offer or take attempt to continue.",
    consequence: "The order will end and may disappear from your active trades.",
    primaryLabel: "Cancel order",
    submittingLabel: "Cancelling order",
    tone: "attention"
  };
}
