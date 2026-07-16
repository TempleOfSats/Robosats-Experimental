import { describe, expect, it } from "vitest";
import { matchedPaymentMethods, paymentIconSrc } from "@/domains/orderbook/paymentMethods";

describe("paymentMethods", () => {
  it("matches old RoboSats payment method names case-insensitively", () => {
    expect(matchedPaymentMethods("Pix Revolut").map((method) => method.icon)).toEqual(["revolut", "pix"]);
  });

  it("does not add a fallback image for unmatched method text", () => {
    expect(matchedPaymentMethods("Local bank branch")).toEqual([]);
    expect(paymentIconSrc("amazonus")).toBe("/static/assets/payment-methods/amazon-us.png");
  });
});
