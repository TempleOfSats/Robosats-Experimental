import { describe, expect, it } from "vitest";
import { jitteredDelay, mapWithConcurrency } from "@/domains/pro/reconcilePolicy";

describe("PRO reconciliation policy", () => {
  it("keeps jitter inside the configured range", () => {
    expect(jitteredDelay(100, 200, () => 0)).toBe(100);
    expect(jitteredDelay(100, 200, () => 0.999)).toBe(200);
  });

  it("preserves order while bounding concurrent work", async () => {
    let active = 0;
    let maximum = 0;
    const values = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 2;
    });

    expect(values).toEqual([2, 4, 6, 8, 10]);
    expect(maximum).toBe(2);
  });
});
