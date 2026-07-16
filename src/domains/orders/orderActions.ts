import type { OrderDto, SubmitOrderActionPayload, TradeViewState } from "@/domains/orders/order.types";
import { currencyCodeFromId } from "@/domains/orderbook/currencies";

export type TradeActionCommand = {
  key: string;
  label: string;
  description: string;
  payload?: SubmitOrderActionPayload;
  variant: "primary" | "secondary" | "outline" | "destructive";
  disabledReason?: string;
};

export function getTradeActionCommands(order: OrderDto, view: TradeViewState): TradeActionCommand[] {
  const actions: TradeActionCommand[] = [];

  if (canCancel(order)) {
    const collaborative = order.status === 9;
    actions.push({
      key: collaborative ? "collaborative-cancel" : "cancel",
      label: collaborative ? (order.pending_cancel ? "Accept cancellation" : "Collaborative cancel") : "Cancel order",
      description:
        collaborative
          ? order.pending_cancel
            ? "Your peer requested cancellation. Accept only if you both agreed in chat; accepting ends the contract and unlocks funds according to its current state."
            : "Ask your peer to cancel this contract together. The trade continues until your peer accepts the request."
          : [6, 7].includes(order.status)
            ? "Unilateral cancellation at this stage can put your bond at risk."
            : "Cancel this order before the trade moves further.",
      payload: { action: "cancel", cancel_status: shouldSendCancelStatus(order) ? order.status : undefined },
      variant: collaborative ? "secondary" : "outline"
    });
  }

  if (order.is_maker && [1, 2].includes(order.status)) {
    actions.push({
      key: "pause",
      label: order.status === 2 ? "Resume order" : "Pause order",
      description: order.status === 2 ? "Make this order visible again." : "Hide this order from the public book.",
      payload: { action: "pause" },
      variant: "outline"
    });
  }

  if (view.panel === "chat" && order.is_buyer && order.status === 9) {
    actions.push({
      key: "confirm-fiat-sent",
      label: "Confirm fiat sent",
      description: `Confirm only after you sent ${tradeFiatAmount(order)}. This cannot be undone normally, and a false confirmation can cost your bond.`,
      payload: { action: "confirm" },
      variant: "primary"
    });
  }

  if (view.panel === "chat" && order.is_buyer && order.status === 10) {
    actions.push({
      key: "undo-confirm",
      label: "Undo fiat sent",
      description: "Use only when the fiat payment definitively failed, the funds are back in your account, and both peers already agreed in chat to collaborate on cancellation.",
      payload: { action: "undo_confirm" },
      variant: "outline"
    });
  }

  if (view.panel === "chat" && order.is_seller && order.status === 10) {
    actions.push({
      key: "confirm-fiat-received",
      label: "Confirm fiat received",
      description: `Confirm only after ${tradeFiatAmount(order)} is visible in your account. This releases the bitcoin escrow to the buyer and cannot be undone.`,
      payload: { action: "confirm" },
      variant: "primary"
    });
  }

  if ([9, 10].includes(order.status)) {
    actions.push({
      key: "open-dispute",
      label: "Open dispute",
      description: "Open a dispute only when the peer is not cooperating. The coordinator cannot read this encrypted chat automatically, so preserve the messages and prepare a factual statement with evidence.",
      payload: { action: "dispute" },
      variant: "outline",
      disabledReason: disputeDisabledReason(order)
    });
  }

  return actions;
}

function tradeFiatAmount(order: OrderDto): string {
  const currency = currencyCodeFromId(order.currency) ?? String(order.currency);
  const amount = Number(order.amount ?? 0).toLocaleString(undefined, {
    maximumFractionDigits: order.currency === 1000 ? 8 : 4
  });
  return `${amount} ${currency}`;
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
