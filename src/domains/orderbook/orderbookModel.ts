import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { currencyCodeFromId } from "@/domains/orderbook/currencies";
import { isSwapPaymentMethod, matchedPaymentMethods } from "@/domains/orderbook/paymentMethods";

export type PublicOrderApi = Partial<Record<keyof PublicOrder | "bond_size" | "bond_size_percent", unknown>>;

export function normalizePublicOrder(order: PublicOrderApi): PublicOrder {
  const currency = toNumber(order.currency);
  const currencyCode = toOptionalString(order.currencyCode) || currencyCodeFromId(currency);
  const bondSizePercent = toOptionalNumber(order.bond_size_percent ?? order.bond_size);
  const satoshisNow = toOptionalNumber(order.satoshis_now);
  const paymentMethod = toStringValue(order.payment_method);
  const description = toOptionalString(order.description)?.trim();
  const isSwap =
    toBoolean(order.is_swap) ||
    currency === 1000 ||
    currencyCode?.toUpperCase() === "BTC" ||
    matchedPaymentMethods(paymentMethod).some(isSwapPaymentMethod);

  return {
    id: toNumber(order.id),
    created_at: toStringValue(order.created_at),
    expires_at: toStringValue(order.expires_at),
    type: toNumber(order.type),
    currency,
    ...(currencyCode ? { currencyCode } : {}),
    amount: toNullableNumber(order.amount),
    has_range: toBoolean(order.has_range),
    ...(toBoolean(order.has_password) ? { has_password: true } : {}),
    is_swap: isSwap,
    min_amount: toNumber(order.min_amount),
    max_amount: toNumber(order.max_amount),
    payment_method: paymentMethod,
    ...(description ? { description } : {}),
    premium: toNumber(order.premium),
    satoshis: toNumber(order.satoshis),
    ...(satoshisNow != null ? { satoshis_now: satoshisNow } : {}),
    maker_nick: toStringValue(order.maker_nick),
    maker_hash_id: toStringValue(order.maker_hash_id),
    bond_size_sats: toNumber(order.bond_size_sats),
    ...(bondSizePercent != null ? { bond_size_percent: bondSizePercent } : {}),
    coordinatorShortAlias: toStringValue(order.coordinatorShortAlias)
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

function toOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = toNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  if (value == null || value === "") return undefined;
  return String(value);
}
