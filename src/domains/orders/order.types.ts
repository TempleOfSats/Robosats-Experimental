type OrderAction =
  | "cancel"
  | "dispute"
  | "pause"
  | "confirm"
  | "undo_confirm"
  | "update_invoice"
  | "update_address"
  | "submit_statement"
  | "rate_platform"
  | "take";

export interface SubmitOrderActionPayload {
  action: OrderAction;
  invoice?: string;
  routing_budget_ppm?: number;
  address?: string;
  mining_fee_rate?: number;
  statement?: string;
  rating?: number;
  amount?: number;
  cancel_status?: number;
  password?: string;
}

export interface OrderDto {
  id: number;
  status: number;
  type: number;
  amount: number | null;
  has_range?: boolean;
  min_amount?: number;
  max_amount?: number;
  currency: number;
  payment_method: string;
  premium: number;
  satoshis: number;
  is_maker: boolean;
  is_taker: boolean;
  is_buyer: boolean;
  is_seller: boolean;
  maker_nick: string;
  maker_hash_id: string;
  taker_nick: string;
  taker_hash_id: string;
  bond_invoice: string;
  bond_satoshis: number;
  bond_size?: number;
  escrow_invoice: string;
  escrow_satoshis: number;
  invoice_amount: number;
  swap_allowed: boolean;
  suggested_mining_fee_rate: number;
  swap_fee_rate: number;
  expires_at: string;
  shortAlias: string;
  status_message?: string;
  escrow_duration?: number;
  total_secs_exp?: number;
  has_password?: boolean;
  maker_locked?: boolean;
  taker_locked?: boolean;
  escrow_locked?: boolean;
  trade_satoshis?: number;
  satoshis_now?: number;
  price_now?: number;
  premium_now?: number;
  trade_fee_percent?: number;
  swap_failure_reason?: string;
  pending_cancel?: boolean;
  asked_for_cancel?: boolean;
  statement_submitted?: boolean;
  retries?: number;
  next_retry_time?: string;
  failure_reason?: string;
  invoice_expired?: boolean;
  expiry_message?: string;
  num_satoshis?: number;
  sent_satoshis?: number;
  txid?: string;
  network?: string;
  chat_last_index?: number;
  description?: string;
  public_duration?: number;
  is_explicit?: boolean;
  latitude?: number;
  longitude?: number;
  penalty?: string;
  expiry_reason?: string;
  tx_queued?: boolean;
  address?: string;
  maker_summary?: Record<string, unknown>;
  taker_summary?: Record<string, unknown>;
  platform_summary?: Record<string, unknown>;
  maker_pubkey?: string;
  taker_pubkey?: string;
  bad_request?: string;
  bad_address?: string;
  bad_invoice?: string;
  bad_statement?: string;
}

export type TradeViewState = {
  status: number;
  title: string;
  tone: "default" | "success" | "warning" | "danger" | "muted";
  requiredAction:
    | "none"
    | "pay_bond"
    | "pay_escrow"
    | "submit_payout"
    | "chat"
    | "submit_statement"
    | "wait"
    | "retry_invoice"
    | "rate"
    | "renew";
  bondStatus: "hide" | "locked" | "unlocked" | "settled";
  panel: TradePanelId;
  message: TradeStepMessage;
};

type TradePanelId =
  | "bond_invoice"
  | "public_order"
  | "paused_order"
  | "cancelled"
  | "expired"
  | "payout"
  | "escrow_invoice"
  | "escrow_wait"
  | "payout_wait"
  | "taker_found"
  | "chat"
  | "dispute_statement"
  | "dispute_peer_wait"
  | "dispute_resolution"
  | "dispute_won"
  | "dispute_lost"
  | "sending_sats"
  | "wait"
  | "routing_failed"
  | "success";

export interface TradeStepMessage {
  heading: string;
  body: string;
  next: string;
}
