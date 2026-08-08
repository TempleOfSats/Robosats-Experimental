import { describe, expect, it } from "vitest";
import { bech32 } from "@scure/base";
import { resolvePaymentExpiry } from "@/domains/payments/paymentExpiry";

// Real bech32-encoded BOLT11 invoices with valid checksums, generated from
// timestamp 1700000000 (2023-11-14T22:13:20Z) and a zeroed 104-word signature.
const INVOICE_EXPIRY_300 =
  "lnbc1pj48ugqxqzfvqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqxvrann";
const INVOICE_EXPIRY_150 =
  "lnbc1pj48ugqxqzykqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9sn8xf";
const INVOICE_NO_EXPIRY =
  "lnbc1pj48ugqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqt7au8w";

describe("resolvePaymentExpiry", () => {
  it.each(["maker_bond", "taker_bond"] as const)(
    "uses the BOLT11 deadline for %s instead of the order lifecycle deadline",
    (concept) => {
      const invoice = concept === "maker_bond" ? INVOICE_EXPIRY_300 : INVOICE_EXPIRY_150;
      const expectedSuffix = concept === "maker_bond" ? "22:18:20.000Z" : "22:15:50.000Z";

      expect(resolvePaymentExpiry(concept, `lightning:${invoice.toUpperCase()}`, "2030-01-01T00:00:00.000Z")).toBe(
        `2023-11-14T${expectedSuffix}`
      );
    }
  );

  it("keeps the coordinator deadline for escrow", () => {
    expect(resolvePaymentExpiry("escrow", "lnbc1escrow", "2030-01-01T00:00:00.000Z")).toBe("2030-01-01T00:00:00.000Z");
  });

  it("does not extend a shorter coordinator bond deadline", () => {
    expect(resolvePaymentExpiry("maker_bond", INVOICE_EXPIRY_300, "2023-11-14T22:16:00.000Z")).toBe(
      "2023-11-14T22:16:00.000Z"
    );
  });

  it("falls back to the coordinator deadline when the bond invoice cannot be decoded", () => {
    expect(resolvePaymentExpiry("maker_bond", "not-an-invoice", "2030-01-01T00:00:00.000Z")).toBe(
      "2030-01-01T00:00:00.000Z"
    );
  });

  it("defaults to 3600 seconds when the invoice has no expiry tag", () => {
    expect(resolvePaymentExpiry("maker_bond", INVOICE_NO_EXPIRY, undefined)).toBe("2023-11-14T23:13:20.000Z");
  });

  it("rejects checksum-valid bech32 data that is not a Lightning invoice", () => {
    const { words } = bech32.decode(INVOICE_NO_EXPIRY, false);
    const notLightning = bech32.encode("bc", words, false);

    expect(resolvePaymentExpiry("maker_bond", notLightning, "2030-01-01T00:00:00.000Z")).toBe(
      "2030-01-01T00:00:00.000Z"
    );
  });

  it("rejects an expiry field whose declared length crosses into the signature", () => {
    const { words } = bech32.decode(INVOICE_NO_EXPIRY, false);
    const malformedWords = [...words.slice(0, 7), 6, 0, 5, 1, ...words.slice(-104)];
    const malformedInvoice = bech32.encode("lnbc", malformedWords, false);

    expect(resolvePaymentExpiry("maker_bond", malformedInvoice, "2030-01-01T00:00:00.000Z")).toBe(
      "2030-01-01T00:00:00.000Z"
    );
  });
});
