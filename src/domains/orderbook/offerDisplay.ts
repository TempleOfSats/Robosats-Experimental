import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

export interface BondDisplayValue {
  sats: number;
  percent?: number;
  sortValue: number;
}

export interface ExpiryRingValue {
  text: string;
  percent: number;
  expired: boolean;
  tone: "danger" | "muted" | "success" | "warning";
}

export interface OrderSatsPreview {
  approx: boolean;
  sats: number;
}

interface PriceLimit {
  price?: number | string | null;
}

const oneDayMs = 24 * 60 * 60 * 1000;

export function bondDisplayValue(order: Pick<PublicOrder, "bond_size_sats" | "bond_size_percent" | "satoshis">): BondDisplayValue {
  const percent = order.bond_size_percent && order.bond_size_percent > 0 ? order.bond_size_percent : undefined;
  const orderSats = knownSatsValue(order.satoshis) ?? 0;
  const sats = order.bond_size_sats > 0 ? order.bond_size_sats : percent && orderSats > 0 ? Math.round(orderSats * (percent / 100)) : 0;
  const computedPercent = percent ?? (orderSats > 0 && sats > 0 ? (sats / orderSats) * 100 : undefined);

  return {
    sats,
    percent: computedPercent,
    sortValue: sats > 0 ? sats : computedPercent ?? 0
  };
}

export function knownSatsValue(value: number | string | null | undefined): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

export function orderSatsPreview(
  order: Pick<PublicOrder, "amount" | "currency" | "has_range" | "max_amount" | "premium" | "satoshis" | "satoshis_now">,
  limits?: Record<string, PriceLimit | undefined>,
  amountOverride?: number
): OrderSatsPreview | undefined {
  const exactSats = knownSatsValue(order.satoshis);
  if (exactSats) return { approx: false, sats: Math.round(exactSats) };

  const apiEstimate = knownSatsValue(order.satoshis_now);
  if (apiEstimate && amountOverride == null) return { approx: true, sats: Math.round(apiEstimate) };

  const amount = amountOverride && amountOverride > 0 ? amountOverride : order.has_range ? order.max_amount : order.amount;
  const fiatAmount = safePositiveNumber(amount);
  const maxRangeAmount = safePositiveNumber(order.max_amount);
  if (apiEstimate && fiatAmount && maxRangeAmount) {
    return {
      approx: true,
      sats: Math.round((apiEstimate * fiatAmount) / maxRangeAmount)
    };
  }

  const basePrice = safePositiveNumber(limits?.[String(order.currency)]?.price);
  if (!fiatAmount || !basePrice) return apiEstimate ? { approx: true, sats: Math.round(apiEstimate) } : undefined;

  const premium = safeNumber(order.premium);
  const adjustedPrice = basePrice * (1 + premium / 100);
  if (adjustedPrice <= 0) return apiEstimate ? { approx: true, sats: Math.round(apiEstimate) } : undefined;

  return {
    approx: true,
    sats: Math.round((100_000_000 * fiatAmount) / adjustedPrice)
  };
}

export function expiryRingValue(expiresAt?: string, nowMs = Date.now()): ExpiryRingValue {
  if (!expiresAt) return { text: "-", percent: 0, expired: false, tone: "muted" };

  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) return { text: "-", percent: 0, expired: false, tone: "muted" };

  const timeToExpiry = Math.abs(expiryMs - nowMs);
  const percent = Math.max(0, Math.min(100, Math.round((timeToExpiry / oneDayMs) * 100)));
  const hours = Math.floor(timeToExpiry / (60 * 60 * 1000));
  const minutes = Math.floor((timeToExpiry % (60 * 60 * 1000)) / 60_000);
  const text = hours < 1 ? `${Math.max(1, minutes)}m` : `${hours}h`;

  return {
    text,
    percent,
    expired: expiryMs <= nowMs,
    tone: expiryRingTone(percent, expiryMs <= nowMs)
  };
}

function expiryRingTone(percent: number, expired: boolean): ExpiryRingValue["tone"] {
  if (expired || percent < 15) return "danger";
  if (percent < 30) return "warning";
  return "success";
}

function safeNumber(value: number | string | null | undefined): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function safePositiveNumber(value: number | string | null | undefined): number | undefined {
  const numberValue = safeNumber(value);
  return numberValue > 0 ? numberValue : undefined;
}

export function formatExpiryCountdown(expiresAt?: string, nowMs = Date.now()): string {
  if (!expiresAt) return "-";

  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) return "-";

  const remainingSeconds = Math.max(0, Math.floor((expiryMs - nowMs) / 1000));
  if (remainingSeconds <= 0) return "Expired";

  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  return `${Math.max(1, minutes)}m`;
}

export function formatExpiryTitle(expiresAt?: string): string {
  if (!expiresAt) return "Expiry not provided";
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) return "Expiry not provided";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(expiryMs));
}
