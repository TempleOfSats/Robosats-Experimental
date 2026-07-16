import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import type { SubmitOrderActionPayload } from "@/domains/orders/order.types";
import { sha256 } from "js-sha256";

export function buildTakeOfferPayload(order: PublicOrder, amountInput: string, passwordInput: string): SubmitOrderActionPayload {
  const rawPassword = passwordInput.trim();
  const password = rawPassword ? sha256(rawPassword) : undefined;

  if (!order.has_range) {
    return { action: "take", password };
  }

  return {
    action: "take",
    amount: normalizedTakeAmount(amountInput),
    password
  };
}

export function defaultTakeAmount(order: PublicOrder): string {
  if (order.has_range) return "";
  return String(order.amount ?? "");
}

export function validateTakeOffer(order: PublicOrder, amountInput: string): string[] {
  if (!order.has_range) return [];

  const amount = normalizedTakeAmount(amountInput);
  if (!Number.isFinite(amount) || amount <= 0) return ["Enter the fiat amount you want to trade."];
  if (amount < order.min_amount || amount > order.max_amount) {
    return [`Amount must be between ${order.min_amount} and ${order.max_amount}.`];
  }
  return [];
}

function normalizedTakeAmount(amountInput: string): number {
  return Number(amountInput);
}
