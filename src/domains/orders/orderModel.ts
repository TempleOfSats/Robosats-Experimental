import type { OrderDto } from "@/domains/orders/order.types";

export type OrderApiResponse = Partial<Record<keyof OrderDto, unknown>>;

export function normalizeOrderDto(data: OrderApiResponse): OrderDto {
  return {
    id: toNumber(data.id),
    status: toNumber(data.status),
    type: toNumber(data.type),
    amount: toNullableNumber(data.amount),
    has_range: toBoolean(data.has_range),
    min_amount: toNumber(data.min_amount),
    max_amount: toNumber(data.max_amount),
    currency: toNumber(data.currency),
    payment_method: toStringValue(data.payment_method),
    premium: toNumber(data.premium),
    satoshis: toNumber(data.satoshis),
    is_maker: toBoolean(data.is_maker),
    is_taker: toBoolean(data.is_taker),
    is_buyer: toBoolean(data.is_buyer),
    is_seller: toBoolean(data.is_seller),
    maker_nick: toStringValue(data.maker_nick),
    maker_hash_id: toStringValue(data.maker_hash_id),
    taker_nick: toStringValue(data.taker_nick),
    taker_hash_id: toStringValue(data.taker_hash_id),
    bond_invoice: toStringValue(data.bond_invoice),
    bond_satoshis: toNumber(data.bond_satoshis),
    bond_size: toNumber(data.bond_size),
    escrow_invoice: toStringValue(data.escrow_invoice),
    escrow_satoshis: toNumber(data.escrow_satoshis),
    invoice_amount: toNumber(data.invoice_amount),
    swap_allowed: toBoolean(data.swap_allowed),
    suggested_mining_fee_rate: toNumber(data.suggested_mining_fee_rate),
    swap_fee_rate: toNumber(data.swap_fee_rate),
    expires_at: toStringValue(data.expires_at),
    shortAlias: toStringValue(data.shortAlias),
    status_message: toOptionalString(data.status_message),
    escrow_duration: toNumber(data.escrow_duration),
    total_secs_exp: toNumber(data.total_secs_exp),
    has_password: toBoolean(data.has_password),
    maker_locked: toBoolean(data.maker_locked),
    taker_locked: toBoolean(data.taker_locked),
    escrow_locked: toBoolean(data.escrow_locked),
    trade_satoshis: toNumber(data.trade_satoshis),
    satoshis_now: toNumber(data.satoshis_now),
    price_now: toNumber(data.price_now),
    premium_now: toNumber(data.premium_now),
    trade_fee_percent: toNumber(data.trade_fee_percent),
    swap_failure_reason: toOptionalString(data.swap_failure_reason),
    pending_cancel: toBoolean(data.pending_cancel),
    asked_for_cancel: toBoolean(data.asked_for_cancel),
    statement_submitted: toBoolean(data.statement_submitted),
    retries: toNumber(data.retries),
    next_retry_time: toOptionalString(data.next_retry_time),
    failure_reason: toOptionalString(data.failure_reason),
    invoice_expired: toBoolean(data.invoice_expired),
    expiry_message: toOptionalString(data.expiry_message),
    num_satoshis: toNumber(data.num_satoshis),
    sent_satoshis: toNumber(data.sent_satoshis),
    txid: toOptionalString(data.txid),
    network: toOptionalString(data.network),
    chat_last_index: toNumber(data.chat_last_index),
    description: toOptionalString(data.description),
    public_duration: toNumber(data.public_duration),
    is_explicit: toBoolean(data.is_explicit),
    latitude: toNumber(data.latitude),
    longitude: toNumber(data.longitude),
    penalty: toOptionalString(data.penalty),
    expiry_reason: toOptionalString(data.expiry_reason),
    tx_queued: toBoolean(data.tx_queued),
    address: toOptionalString(data.address),
    maker_summary: toOptionalRecord(data.maker_summary),
    taker_summary: toOptionalRecord(data.taker_summary),
    platform_summary: toOptionalRecord(data.platform_summary),
    maker_pubkey: toOptionalString(data.maker_pubkey),
    taker_pubkey: toOptionalString(data.taker_pubkey),
    bad_request: toOptionalString(data.bad_request),
    bad_address: toOptionalString(data.bad_address),
    bad_invoice: toOptionalString(data.bad_invoice),
    bad_statement: toOptionalString(data.bad_statement)
  };
}

export function orderReferenceSats(order: OrderDto): number {
  const directCandidates = [
    order.trade_satoshis,
    order.invoice_amount,
    order.escrow_satoshis,
    order.satoshis_now,
    order.satoshis
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) return candidate;
  }

  // Before the taker bond locks, RoboSats may not return a final trade amount.
  // The bond was calculated from the same pre-take estimate, so it is the most
  // accurate available fallback and differs by at most integer rounding.
  if (order.bond_satoshis > 0 && order.bond_size && order.bond_size > 0) {
    return Math.round((order.bond_satoshis * 100) / order.bond_size);
  }

  return 0;
}

export function isOrderReferenceSatsApproximate(order: OrderDto): boolean {
  const hasDirectAmount = [
    order.trade_satoshis,
    order.invoice_amount,
    order.escrow_satoshis,
    order.satoshis_now,
    order.satoshis
  ].some((candidate) => typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0);
  return !hasDirectAmount && order.bond_satoshis > 0 && Boolean(order.bond_size && order.bond_size > 0);
}

export function orderReferenceSatsRange(order: OrderDto): { minimum: number; maximum: number } | undefined {
  if (!order.has_range || positiveNumber(order.amount)) return undefined;

  const minimumAmount = positiveNumber(order.min_amount);
  const maximumAmount = positiveNumber(order.max_amount);
  const maximumSats = orderReferenceSats(order);
  if (!minimumAmount || !maximumAmount || maximumAmount < minimumAmount || maximumSats <= 0) return undefined;

  return {
    minimum: Math.round(maximumSats * (minimumAmount / maximumAmount)),
    maximum: maximumSats
  };
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  return toNumber(value);
}

function positiveNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.trim().toLowerCase() === "true" || value === "1";
  return false;
}

function toStringValue(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function toOptionalString(value: unknown): string | undefined {
  const text = toStringValue(value);
  return text ? text : undefined;
}

function toOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
