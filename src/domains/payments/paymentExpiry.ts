import { bech32 } from "@scure/base";
import type { PaymentConcept } from "@/domains/payments/payment.types";

const MAX_INVOICE_LENGTH = 20_000;
const SIGNATURE_WORD_COUNT = 104;
const DEFAULT_EXPIRY_SECONDS = 3600;
const EXPIRY_TAG_ID = 6;

export function resolvePaymentExpiry(
  concept: PaymentConcept,
  invoice: string,
  fallback?: string | null
): string | undefined {
  if (concept !== "maker_bond" && concept !== "taker_bond") return fallback || undefined;

  const paymentRequest = normalizePaymentRequest(invoice);
  if (!paymentRequest) return fallback || undefined;

  try {
    const { timestamp, expiry } = decodeBolt11TimestampAndExpiry(paymentRequest);
    if (!Number.isFinite(timestamp) || !Number.isFinite(expiry)) return fallback || undefined;

    const invoiceDeadline = (timestamp + expiry) * 1_000;
    const coordinatorDeadline = fallback ? Date.parse(fallback) : Number.NaN;
    const deadline = new Date(
      Number.isFinite(coordinatorDeadline) ? Math.min(invoiceDeadline, coordinatorDeadline) : invoiceDeadline
    );
    return Number.isNaN(deadline.getTime()) ? fallback || undefined : deadline.toISOString();
  } catch {
    return fallback || undefined;
  }
}

function decodeBolt11TimestampAndExpiry(invoice: string): { timestamp: number; expiry: number } {
  const { prefix, words } = bech32.decode(invoice, false);
  if (!prefix.startsWith("ln") || prefix.length <= 2) throw new Error("Invalid BOLT11 human-readable prefix");
  if (words.length < SIGNATURE_WORD_COUNT + 7) throw new Error("BOLT11 invoice too short");

  let timestamp = 0;
  for (let i = 0; i < 7; i++) timestamp = timestamp * 32 + words[i];

  const tagStreamEnd = words.length - SIGNATURE_WORD_COUNT;
  let pos = 7;
  while (pos + 2 < tagStreamEnd) {
    const tagId = words[pos];
    const dataLength = words[pos + 1] * 32 + words[pos + 2];
    pos += 3;
    const dataEnd = pos + dataLength;
    if (dataEnd > tagStreamEnd) throw new Error("BOLT11 tagged field exceeds the data section");
    if (tagId === EXPIRY_TAG_ID) {
      if (dataLength === 0) throw new Error("BOLT11 expiry tag is empty");
      let expiry = 0;
      for (let i = 0; i < dataLength; i++) {
        expiry = expiry * 32 + words[pos + i];
      }
      return { timestamp, expiry };
    }
    pos = dataEnd;
  }

  return { timestamp, expiry: DEFAULT_EXPIRY_SECONDS };
}

function normalizePaymentRequest(invoice: string): string | undefined {
  const value = invoice.trim().replace(/^lightning:/i, "");
  if (!value || value.length > MAX_INVOICE_LENGTH) return undefined;
  return value.toLowerCase();
}
