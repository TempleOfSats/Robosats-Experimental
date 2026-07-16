import { describe, expect, it } from "vitest";
import { tradeMotionClass } from "@/domains/motion/tradeMotion";

describe("tradeMotionClass", () => {
  it("uses success motion only for finished trades", () => {
    expect(tradeMotionClass({ status: 14, bondStatus: "unlocked" })).toBe("trade-payout-success");
  });

  it("uses locked transition for locked bond states", () => {
    expect(tradeMotionClass({ status: 7, bondStatus: "locked" })).toBe("trade-locked-transition");
  });
});
