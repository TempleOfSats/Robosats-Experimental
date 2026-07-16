import { describe, expect, it } from "vitest";
import { lightningPayoutAmount, lightningRoutingBudgetSats, onchainPayoutBreakdown } from "@/domains/payments/payoutAmounts";

describe("payout amount calculations", () => {
  it("matches the current Lightning routing-budget calculation", () => {
    expect(lightningPayoutAmount(418_556, 1_000)).toBe(418_137);
    expect(lightningRoutingBudgetSats(418_556, 1_000)).toBe(419);
    expect(lightningPayoutAmount(418_556, 0)).toBe(418_556);
  });

  it("matches the current 280-vbyte on-chain estimate", () => {
    expect(onchainPayoutBreakdown(418_556, 2.2, 2.05)).toEqual({
      effectiveMiningFeeRate: 2.05,
      finalSats: 408_774,
      miningFeeSats: 574,
      swapFeeSats: 9_208
    });
  });
});
