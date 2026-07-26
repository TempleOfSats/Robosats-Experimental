import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { matchedPaymentMethods } from "@/domains/orderbook/paymentMethods";
import { roleBuysBitcoin } from "@/domains/orders/orderRole";

export type GuidedTradeIntent = "buy" | "sell";

export type GuidedTradeCriteria = {
  intent: GuidedTradeIntent;
  currency: string;
  amount: number;
  paymentMethod: string;
};

export function guidedTradeMatches(order: PublicOrder, criteria: GuidedTradeCriteria, now = Date.now()): boolean {
  if (!isGuidedOfferAvailable(order, now)) return false;
  if (roleBuysBitcoin(order.type, "taker") !== (criteria.intent === "buy")) return false;
  if ((order.currencyCode ?? String(order.currency)).toUpperCase() !== criteria.currency.toUpperCase()) return false;
  if (!orderSupportsAmount(order, criteria.amount)) return false;
  return orderSupportsPaymentMethod(order.payment_method, criteria.paymentMethod);
}

export function findGuidedTradeMatches(
  orders: PublicOrder[],
  criteria: GuidedTradeCriteria,
  now = Date.now()
): PublicOrder[] {
  return orders
    .filter((order) => guidedTradeMatches(order, criteria, now))
    .sort((left, right) => compareGuidedMatches(left, right, criteria.intent));
}

export function guidedPaymentMethods(
  orders: PublicOrder[],
  criteria: Pick<GuidedTradeCriteria, "amount" | "currency" | "intent">,
  now = Date.now()
): string[] {
  const counts = new Map<string, number>();

  for (const order of orders) {
    if (!isGuidedOfferAvailable(order, now)) continue;
    if (roleBuysBitcoin(order.type, "taker") !== (criteria.intent === "buy")) continue;
    if ((order.currencyCode ?? String(order.currency)).toUpperCase() !== criteria.currency.toUpperCase()) continue;
    if (!orderSupportsAmount(order, criteria.amount)) continue;

    for (const method of matchedPaymentMethods(order.payment_method)) {
      counts.set(method.name, (counts.get(method.name) ?? 0) + 1);
    }
  }

  return [...counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([method]) => method);
}

export function guidedCurrencyCodes(orders: PublicOrder[], intent: GuidedTradeIntent, now = Date.now()): string[] {
  const counts = new Map<string, number>();

  for (const order of orders) {
    if (!isGuidedOfferAvailable(order, now)) continue;
    if (roleBuysBitcoin(order.type, "taker") !== (intent === "buy")) continue;
    const currency = (order.currencyCode ?? String(order.currency)).toUpperCase();
    counts.set(currency, (counts.get(currency) ?? 0) + 1);
  }

  return [...counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([currency]) => currency);
}

function orderSupportsAmount(order: PublicOrder, amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (order.has_range) return amount >= order.min_amount && amount <= order.max_amount;
  return order.amount != null && approximatelyEqual(order.amount, amount);
}

function isGuidedOfferAvailable(order: PublicOrder, now: number): boolean {
  if (order.is_swap || order.has_password) return false;
  if (!order.expires_at) return true;
  const expiresAt = Date.parse(order.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function orderSupportsPaymentMethod(orderMethod: string, selectedMethod: string): boolean {
  const normalizedMethod = selectedMethod.trim().toLowerCase();
  if (!normalizedMethod) return false;
  if (orderMethod.trim().toLowerCase() === normalizedMethod) return true;
  if (matchedPaymentMethods(orderMethod).some((method) => method.name.toLowerCase() === normalizedMethod)) return true;
  return orderMethod.toLowerCase().includes(normalizedMethod);
}

function compareGuidedMatches(left: PublicOrder, right: PublicOrder, intent: GuidedTradeIntent): number {
  const premiumDifference = left.premium - right.premium;
  if (premiumDifference !== 0) return intent === "buy" ? premiumDifference : -premiumDifference;

  const leftExpiry = left.expires_at ? Date.parse(left.expires_at) : Number.POSITIVE_INFINITY;
  const rightExpiry = right.expires_at ? Date.parse(right.expires_at) : Number.POSITIVE_INFINITY;
  if (leftExpiry !== rightExpiry) return rightExpiry - leftExpiry;

  return `${left.coordinatorShortAlias}:${left.id}`.localeCompare(`${right.coordinatorShortAlias}:${right.id}`);
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1, Math.abs(left), Math.abs(right)) * Number.EPSILON * 8;
}
