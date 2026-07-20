import { beforeEach, describe, expect, it, vi } from "vitest";
import { decode } from "light-bolt11-decoder";
import { resolvePaymentExpiry } from "@/domains/payments/paymentExpiry";

vi.mock("light-bolt11-decoder", () => ({ decode: vi.fn() }));

const decodeMock = vi.mocked(decode);

describe("resolvePaymentExpiry", () => {
  beforeEach(() => decodeMock.mockReset());

  it.each(["maker_bond", "taker_bond"] as const)(
    "uses the BOLT11 deadline for %s instead of the order lifecycle deadline",
    (concept) => {
      decodeMock.mockReturnValue({
        paymentRequest: "lnbc1bond",
        sections: [{ name: "timestamp", letters: "test", value: 1_700_000_000 }],
        expiry: concept === "maker_bond" ? 300 : 150,
        route_hints: []
      });

      expect(resolvePaymentExpiry(concept, "LIGHTNING:LNBC1BOND", "2030-01-01T00:00:00.000Z"))
        .toBe(concept === "maker_bond" ? "2023-11-14T22:18:20.000Z" : "2023-11-14T22:15:50.000Z");
      expect(decodeMock).toHaveBeenCalledWith("lnbc1bond");
    }
  );

  it("keeps the coordinator deadline for escrow", () => {
    expect(resolvePaymentExpiry("escrow", "lnbc1escrow", "2030-01-01T00:00:00.000Z"))
      .toBe("2030-01-01T00:00:00.000Z");
    expect(decodeMock).not.toHaveBeenCalled();
  });

  it("does not extend a shorter coordinator bond deadline", () => {
    decodeMock.mockReturnValue({
      paymentRequest: "lnbc1bond",
      sections: [{ name: "timestamp", letters: "test", value: 1_700_000_000 }],
      expiry: 300,
      route_hints: []
    });

    expect(resolvePaymentExpiry("maker_bond", "lnbc1bond", "2023-11-14T22:16:00.000Z"))
      .toBe("2023-11-14T22:16:00.000Z");
  });

  it("falls back to the coordinator deadline when the bond invoice cannot be decoded", () => {
    decodeMock.mockReturnValue(undefined as never);

    expect(resolvePaymentExpiry("maker_bond", "not-an-invoice", "2030-01-01T00:00:00.000Z"))
      .toBe("2030-01-01T00:00:00.000Z");
  });
});
