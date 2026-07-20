import { decode } from "light-bolt11-decoder";
import type { PaymentConcept } from "@/domains/payments/payment.types";

const MAX_INVOICE_LENGTH = 20_000;

export function resolvePaymentExpiry(
  concept: PaymentConcept,
  invoice: string,
  fallback?: string | null
): string | undefined {
  if (concept !== "maker_bond" && concept !== "taker_bond") return fallback || undefined;

  const paymentRequest = normalizePaymentRequest(invoice);
  if (!paymentRequest) return fallback || undefined;

  try {
    const decoded = decode(paymentRequest);
    const timestamp = decoded.sections.find((section) => section.name === "timestamp")?.value;
    const expirySeconds = decoded.expiry;
    if (!Number.isFinite(timestamp) || !Number.isFinite(expirySeconds)) return fallback || undefined;

    const invoiceDeadline = (Number(timestamp) + Number(expirySeconds)) * 1_000;
    const coordinatorDeadline = fallback ? Date.parse(fallback) : Number.NaN;
    const deadline = new Date(Number.isFinite(coordinatorDeadline)
      ? Math.min(invoiceDeadline, coordinatorDeadline)
      : invoiceDeadline);
    return Number.isNaN(deadline.getTime()) ? fallback || undefined : deadline.toISOString();
  } catch {
    return fallback || undefined;
  }
}

function normalizePaymentRequest(invoice: string): string | undefined {
  const value = invoice.trim().replace(/^lightning:/i, "");
  if (!value || value.length > MAX_INVOICE_LENGTH) return undefined;
  return value.toLowerCase();
}
