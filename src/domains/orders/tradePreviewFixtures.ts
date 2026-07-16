import type { OrderDto } from "@/domains/orders/order.types";

export type TradePreviewScenario =
  | "trust-coordinator"
  | "maker-bond"
  | "public"
  | "paused"
  | "taker-wait"
  | "take"
  | "cancelled"
  | "expired"
  | "setup-buyer"
  | "setup-seller"
  | "escrow-wait"
  | "escrow-lock"
  | "payout-submit"
  | "payout-wait"
  | "chat-buyer"
  | "chat-seller"
  | "dispute"
  | "dispute-peer-wait"
  | "collaborative-cancel"
  | "resolution"
  | "payout"
  | "payout-seller"
  | "success"
  | "routing-auto"
  | "routing-retry"
  | "routing-seller"
  | "dispute-won-taker"
  | "dispute-lost-maker"
  | "dispute-won-maker"
  | "dispute-lost-taker";

export type TradePreviewCase = {
  id: TradePreviewScenario;
  label: string;
  group: "Publish" | "Setup" | "Trade" | "Dispute" | "Payout";
  description: string;
};

export const TRADE_PREVIEW_CASES: readonly TradePreviewCase[] = [
  { id: "trust-coordinator", label: "Trust coordinator", group: "Publish", description: "Review the coordinator before locking a bond." },
  { id: "maker-bond", label: "Maker bond", group: "Publish", description: "Maker reviews and locks the publication bond." },
  { id: "public", label: "Public order", group: "Publish", description: "Published offer waiting for a taker." },
  { id: "paused", label: "Taker found", group: "Publish", description: "Public offer paused while a taker starts." },
  { id: "taker-wait", label: "Awaiting taker bond", group: "Publish", description: "Maker waits for the taker bond." },
  { id: "take", label: "Take order", group: "Publish", description: "Taker reviews and locks the taker bond." },
  { id: "cancelled", label: "Cancelled", group: "Publish", description: "Order cancelled before completion." },
  { id: "expired", label: "Expired", group: "Publish", description: "Public offer expired without a taker." },
  { id: "setup-buyer", label: "Buyer setup", group: "Setup", description: "Buyer submits a payout destination." },
  { id: "setup-seller", label: "Seller setup", group: "Setup", description: "Seller prepares trade collateral." },
  { id: "escrow-wait", label: "Waiting for escrow", group: "Setup", description: "Buyer waits for seller collateral." },
  { id: "escrow-lock", label: "Lock escrow", group: "Setup", description: "Seller locks the collateral invoice." },
  { id: "payout-submit", label: "Submit payout", group: "Setup", description: "Buyer enters the receiving invoice or address." },
  { id: "payout-wait", label: "Waiting for payout", group: "Setup", description: "Seller waits for buyer payout setup." },
  { id: "chat-buyer", label: "Buyer chat", group: "Trade", description: "Buyer chat and fiat-sent controls." },
  { id: "chat-seller", label: "Seller chat", group: "Trade", description: "Seller chat and fiat-received controls." },
  { id: "collaborative-cancel", label: "Collaborative cancel", group: "Trade", description: "Both peers cancelled the trade." },
  { id: "dispute", label: "Dispute statement", group: "Dispute", description: "Submit evidence and contact details." },
  { id: "dispute-peer-wait", label: "Waiting for peer", group: "Dispute", description: "Statement submitted; waiting for the peer." },
  { id: "resolution", label: "Coordinator review", group: "Dispute", description: "Both statements are under review." },
  { id: "dispute-won-taker", label: "Taker won dispute", group: "Dispute", description: "Taker-side dispute resolution." },
  { id: "dispute-lost-maker", label: "Maker lost dispute", group: "Dispute", description: "Maker-side loss resolution." },
  { id: "dispute-won-maker", label: "Maker won dispute", group: "Dispute", description: "Maker-side dispute resolution." },
  { id: "dispute-lost-taker", label: "Taker lost dispute", group: "Dispute", description: "Taker-side loss resolution." },
  { id: "payout", label: "Routing payout", group: "Payout", description: "Coordinator is routing the payout." },
  { id: "payout-seller", label: "Seller payout wait", group: "Payout", description: "Seller waits for buyer payout completion." },
  { id: "routing-auto", label: "Automatic retry", group: "Payout", description: "Temporary route failure with automatic retry." },
  { id: "routing-retry", label: "Replace invoice", group: "Payout", description: "Expired invoice requires a replacement." },
  { id: "routing-seller", label: "Seller completed", group: "Payout", description: "Seller sees the completed payout state." },
  { id: "success", label: "Trade complete", group: "Payout", description: "Completed trade, receipt, and rating controls." }
];

const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
const baseOrder: OrderDto = {
  id: 95955,
  status: 3,
  type: 1,
  amount: 3000,
  currency: 20,
  payment_method: "PIX",
  premium: 8,
  satoshis: 842070,
  satoshis_now: 842070,
  trade_satoshis: 836120,
  is_maker: false,
  is_taker: true,
  is_buyer: true,
  is_seller: false,
  maker_nick: "CopperRiver842",
  maker_hash_id: "maker-preview",
  taker_nick: "InterracialUnit93",
  taker_hash_id: "taker-preview",
  bond_invoice: "lnbc59090n1pntakepreviewpp5k7jv4v9qz0m8d6uh8t9g5dkj2sj0t9e9p3q6x2c8r7w5y4z3x2qsp5preview",
  bond_satoshis: 5909,
  escrow_invoice: "lnbc8420700n1pnescrowpreviewpp5p4y7v9w2r8q6m3k5d0s4h2j8l6a9f7g5c3x1z0v2b4n6m8q0p2sp5preview",
  escrow_satoshis: 842070,
  invoice_amount: 836120,
  swap_allowed: true,
  suggested_mining_fee_rate: 2.1,
  swap_fee_rate: 2.2,
  expires_at: expiresAt,
  escrow_duration: 10800,
  total_secs_exp: 10800,
  maker_locked: true,
  taker_locked: false,
  escrow_locked: false,
  shortAlias: "lake"
};

const makerSeller = {
  is_maker: true,
  is_taker: false,
  is_buyer: false,
  is_seller: true
} as const;

export function tradePreviewOrder(value: string | null): OrderDto | undefined {
  if (!value) return undefined;
  const scenario = value as TradePreviewScenario;

  switch (scenario) {
    case "trust-coordinator":
      return { ...baseOrder, ...makerSeller, status: 0, maker_locked: false, status_message: "Waiting for maker bond" };
    case "maker-bond":
      return { ...baseOrder, ...makerSeller, status: 0, maker_locked: false, status_message: "Waiting for maker bond" };
    case "public":
      return { ...baseOrder, ...makerSeller, status: 1, status_message: "Public order" };
    case "paused":
      return { ...baseOrder, ...makerSeller, status: 2, status_message: "Paused order" };
    case "taker-wait":
      return { ...baseOrder, ...makerSeller, status: 3, status_message: "Waiting for taker bond" };
    case "take":
      return {
        ...baseOrder,
        status: 3,
        satoshis: 0,
        satoshis_now: 0,
        trade_satoshis: 0,
        invoice_amount: 0,
        escrow_satoshis: 0,
        bond_satoshis: 4468,
        bond_size: 3,
        status_message: "Waiting for taker bond"
      };
    case "cancelled":
      return { ...baseOrder, status: 4, status_message: "Cancelled order" };
    case "expired":
      return { ...baseOrder, ...makerSeller, status: 5, expiry_message: "The public order expired before another robot took it.", status_message: "Expired order" };
    case "setup-buyer":
      return {
        ...baseOrder,
        status: 6,
        taker_locked: true,
        status_message: "Waiting for trade collateral and buyer invoice"
      };
    case "setup-seller":
      return {
        ...baseOrder,
        status: 6,
        is_maker: true,
        is_taker: false,
        is_buyer: false,
        is_seller: true,
        taker_locked: true,
        status_message: "Waiting for trade collateral and buyer invoice"
      };
    case "escrow-wait":
      return { ...baseOrder, status: 7, taker_locked: true, status_message: "Waiting for seller collateral" };
    case "escrow-lock":
      return { ...baseOrder, ...makerSeller, status: 7, taker_locked: true, status_message: "Waiting for trade collateral" };
    case "payout-submit":
      return { ...baseOrder, status: 8, taker_locked: true, escrow_locked: true, status_message: "Waiting for buyer payout" };
    case "payout-wait":
      return { ...baseOrder, ...makerSeller, status: 8, taker_locked: true, escrow_locked: true, status_message: "Waiting for buyer payout" };
    case "chat-buyer":
      return {
        ...baseOrder,
        status: 9,
        taker_locked: true,
        escrow_locked: true,
        status_message: "Sending fiat - In chatroom"
      };
    case "chat-seller":
      return {
        ...baseOrder,
        status: 10,
        is_maker: true,
        is_taker: false,
        is_buyer: false,
        is_seller: true,
        taker_locked: true,
        escrow_locked: true,
        status_message: "Fiat sent - In chatroom"
      };
    case "dispute":
      return {
        ...baseOrder,
        status: 11,
        taker_locked: true,
        escrow_locked: true,
        statement_submitted: false,
        status_message: "In dispute"
      };
    case "dispute-peer-wait":
      return { ...baseOrder, status: 11, taker_locked: true, escrow_locked: true, statement_submitted: true, status_message: "Waiting for peer statement" };
    case "collaborative-cancel":
      return { ...baseOrder, status: 12, taker_locked: true, escrow_locked: true, status_message: "Collaboratively cancelled" };
    case "resolution":
      return {
        ...baseOrder,
        status: 16,
        taker_locked: true,
        escrow_locked: true,
        statement_submitted: true,
        status_message: "Both statements submitted"
      };
    case "payout":
      return {
        ...baseOrder,
        status: 13,
        taker_locked: true,
        escrow_locked: true,
        status_message: "Sending sats"
      };
    case "payout-seller":
      return { ...baseOrder, ...makerSeller, status: 13, taker_locked: true, escrow_locked: true, num_satoshis: 836120, sent_satoshis: 836120, status_message: "Sending sats" };
    case "success":
      return {
        ...baseOrder,
        status: 14,
        taker_locked: true,
        escrow_locked: true,
        num_satoshis: 836120,
        sent_satoshis: 836120,
        status_message: "Successful trade"
      };
    case "routing-auto":
      return { ...baseOrder, status: 15, taker_locked: true, escrow_locked: true, invoice_expired: false, retries: 2, failure_reason: "Temporary route unavailable", status_message: "Routing retry scheduled" };
    case "routing-retry":
      return { ...baseOrder, status: 15, taker_locked: true, escrow_locked: true, invoice_expired: true, retries: 3, failure_reason: "Invoice expired", status_message: "Replacement invoice required" };
    case "routing-seller":
      return { ...baseOrder, ...makerSeller, status: 15, taker_locked: true, escrow_locked: true, num_satoshis: 836120, sent_satoshis: 836120, status_message: "Trade complete" };
    case "dispute-won-taker":
      return { ...baseOrder, status: 17, taker_locked: true, escrow_locked: true, status_message: "Dispute won" };
    case "dispute-lost-maker":
      return { ...baseOrder, ...makerSeller, status: 17, taker_locked: true, escrow_locked: true, status_message: "Dispute lost" };
    case "dispute-won-maker":
      return { ...baseOrder, ...makerSeller, status: 18, taker_locked: true, escrow_locked: true, status_message: "Dispute won" };
    case "dispute-lost-taker":
      return { ...baseOrder, status: 18, taker_locked: true, escrow_locked: true, status_message: "Dispute lost" };
    default:
      return undefined;
  }
}
