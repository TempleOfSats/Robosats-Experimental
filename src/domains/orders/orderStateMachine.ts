import type { OrderDto, TradeStepMessage, TradeViewState } from "@/domains/orders/order.types";

type ViewOverrides = Omit<TradeViewState, "status" | "message"> & { message: TradeStepMessage };

export function getTradeViewState(order: OrderDto): TradeViewState {
  const view = viewForOrder(order);
  return { status: order.status, ...view };
}

function viewForOrder(order: OrderDto): ViewOverrides {
  switch (order.status) {
    case 0:
      return order.is_maker
        ? view("Lock your bond to publish the order", "warning", "pay_bond", "hide", "bond_invoice",
            "Lock the maker bond", "This hold invoice freezes the bond in your wallet. It is charged only if you cancel improperly or lose a dispute.", "Once locked, your offer becomes public.")
        : wait("Waiting for the maker to lock the bond", "The offer cannot be published until its maker bond is locked.");
    case 1:
      return order.is_maker
        ? view("Your order is public", "default", "wait", order.maker_locked ? "locked" : "hide", "public_order",
            "Waiting for a taker", publicWaitBody(order), "If the order expires untaken, your bond will return to you (no action needed).")
        : wait("This order is public", "It is available in the order book, but it does not belong to this robot.");
    case 2:
      return view("Your order is paused", "muted", "none", order.is_maker && order.maker_locked ? "locked" : "hide", "paused_order",
        "Order hidden from the book", "Other robots cannot see or take this order while it is paused.", "Resume it when you are ready to trade.");
    case 3:
      return order.is_taker
        ? view("Lock your bond to take the order", "warning", "pay_bond", "hide", "bond_invoice",
            "Lock the taker bond", "This hold invoice formalizes the contract and freezes your fidelity bond.", "Once locked, collateral and payout setup begin.")
        : view("A taker has been found!", "warning", "wait", "locked", "taker_found",
            "Waiting for the taker bond", "Please wait for the taker to lock a bond. If the taker does not lock a bond in time, the order will be made public again.", "No action is required from you.");
    case 4:
      return view("Order cancelled", "muted", "none", "hide", "cancelled",
        "This order was cancelled", "The contract did not complete.", "You can create or take another order.");
    case 5:
      return view("The order has expired", "muted", "renew", "hide", "expired",
        "Order expired", order.expiry_message || "A required action was not completed before the deadline.", order.is_maker ? "You may renew the order." : "No further action is required.");
    case 6:
      return setupView(order);
    case 7:
      return order.is_seller
        ? escrowView(order)
        : view("Your payout info looks good", "default", "wait", "locked", "escrow_wait",
            "Waiting for seller collateral", "We are waiting for the seller to lock the trade amount.", "If the seller does not deposit in time, your bond returns automatically and you may receive compensation.");
    case 8:
      return order.is_buyer
        ? payoutView()
        : view("The trade collateral is locked", "default", "wait", "locked", "payout_wait",
            "Waiting for buyer payout info", "The buyer still needs to post a Lightning invoice or, when available, an on-chain address.", "If the buyer does not cooperate in time, your collateral and bond return automatically and you may receive compensation.");
    case 9:
      return chatView(order, "The buyer should send fiat using the agreed method and then confirm it in this trade.");
    case 10:
      return chatView(order, "The buyer marked fiat as sent. The seller must confirm only after the funds arrive.");
    case 11:
      return order.statement_submitted
        ? view("We have received your statement", "warning", "wait", "settled", "dispute_peer_wait",
            "Waiting for your peer's statement", "The coordinator has your evidence and is waiting for the other participant.", "Keep the information needed to identify the order and payments available if the coordinator contacts you.")
        : view("A dispute has been opened", "danger", "submit_statement", "settled", "dispute_statement",
            "Submit your dispute statement", "Explain what happened factually and include the payment status, relevant timestamps, and concise evidence.", "The coordinator reviews both statements after submission.");
    case 12:
      return view("Trade collaboratively cancelled", "muted", "none", "unlocked", "cancelled",
        "Both robots agreed to cancel", "The trade ended without a payout.", "Bonds and collateral unlock according to their final contract state.");
    case 13:
      return order.is_seller
        ? successView("Trade finished")
        : view("Attempting Lightning payment", "warning", "wait", "unlocked", "sending_sats",
            "Sending sats", "The coordinator is routing your payout. Keep this order available until the payment resolves.", "If routing fails, you will be able to provide a replacement invoice.");
    case 14:
      return successView("Trade finished");
    case 15:
      return order.is_buyer
        ? view("Lightning routing failed", "warning", order.invoice_expired ? "retry_invoice" : "wait", "unlocked", "routing_failed",
            "The payout could not be routed", routingFailureBody(order), order.invoice_expired ? "Submit a fresh invoice to retry the payout." : "The coordinator retries automatically unless a replacement invoice is required.")
        : successView("Trade finished");
    case 16:
      return view("We have both statements", "warning", "wait", "settled", "dispute_resolution",
        "Waiting for the coordinator's resolution", "The coordinator is reviewing both participants' statements and evidence.", "No further action is required unless the coordinator contacts you.");
    case 17:
    case 18: {
      const lost = (order.status === 17 && order.is_maker) || (order.status === 18 && order.is_taker);
      return lost
        ? view("You have lost the dispute", "danger", "none", "settled", "dispute_lost",
            "Dispute resolved", "The coordinator resolved the dispute in favor of your peer.", "Review the final order state and contact the coordinator only if clarification is needed.")
        : view("You have won the dispute", "success", "none", "settled", "dispute_won",
            "Dispute resolved in your favor", "The coordinator resolved the dispute in your favor. The resolution amount can be claimed from your robot's rewards.", "Review the final state in your robot profile.");
    }
    default:
      return wait("Waiting for the next update", "The coordinator returned an order status this frontend does not recognize yet.");
  }
}

function setupView(order: OrderDto): ViewOverrides {
  if (order.is_buyer) return payoutView();
  if (order.is_seller) return escrowView(order);
  return wait("Waiting for trade setup", "The participants are preparing collateral and payout information.");
}

function payoutView(): ViewOverrides {
  return view("Submit payout info", "warning", "submit_payout", "locked", "payout",
    "Choose how to receive bitcoin", "Before you send fiat, provide a valid payout destination for the exact trade amount.", "Once both payout info and seller collateral are ready, encrypted chat opens.");
}

function escrowView(order: OrderDto): ViewOverrides {
  return view("Lock the trade amount as collateral", "warning", "pay_escrow", "locked", "escrow_invoice",
    "Lock seller collateral", "This hold invoice freezes the bitcoin being sold. It releases to the buyer only after you confirm receipt of fiat.", `Lock it within ${formatDuration(order.escrow_duration)} to avoid risking your bond.`);
}

function chatView(order: OrderDto, body: string): ViewOverrides {
  return view(order.is_buyer ? "Chat with the seller" : "Chat with the buyer", "default", "chat", "locked", "chat",
    order.status === 9 ? "Exchange payment details" : "Fiat marked as sent", body, order.is_buyer ? "Use the confirmation button only after sending fiat." : "Confirm receipt only after the fiat is visible in your account.");
}

function successView(title: string): ViewOverrides {
  return view(title, "success", "rate", "unlocked", "success",
    "Trade successful", "The trade completed and the bitcoin payout was released.", "Review the receipt and rate your coordinator.");
}

function wait(title: string, body: string): ViewOverrides {
  return view(title, "muted", "wait", "hide", "wait", title, body, "No action is required right now.");
}

function view(
  title: string,
  tone: ViewOverrides["tone"],
  requiredAction: ViewOverrides["requiredAction"],
  bondStatus: ViewOverrides["bondStatus"],
  panel: ViewOverrides["panel"],
  heading: string,
  body: string,
  next: string
): ViewOverrides {
  return { title, tone, requiredAction, bondStatus, panel, message: { heading, body, next } };
}

function formatDuration(seconds = 0): string {
  if (!seconds) return "the displayed deadline";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""].filter(Boolean).join(" ") || "a few minutes";
}

function publicWaitBody(order: OrderDto): string {
  return `Be patient while robots check the book. This box will ring once a robot takes your order, then you will have ${formatDuration(order.escrow_duration)} to reply. If you do not reply, you risk losing your bond.`;
}

function routingFailureBody(order: OrderDto): string {
  const reason = order.failure_reason ? ` Reason: ${order.failure_reason}.` : "";
  const attempt = order.retries ? ` Routing attempt ${order.retries} failed.` : "";
  return `The bitcoin payout has not completed.${attempt}${reason}`;
}
