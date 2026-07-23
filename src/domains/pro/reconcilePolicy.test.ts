import { describe, expect, it } from "vitest";
import {
  canBypassCadence,
  isRobotStatusStale,
  jitteredDelay,
  mapWithConcurrency,
  PRO_RECONCILE_POLICY,
  shouldRefreshRobotStatus
} from "@/domains/pro/reconcilePolicy";

describe("PRO reconciliation policy", () => {
  it("keeps jitter inside the configured range", () => {
    expect(jitteredDelay(100, 200, () => 0)).toBe(100);
    expect(jitteredDelay(100, 200, () => 0.999)).toBe(200);
  });

  it("retries immediately when Fleet or network availability changes", () => {
    expect(canBypassCadence("fleet-ready")).toBe(true);
    expect(canBypassCadence("tor-ready")).toBe(true);
    expect(canBypassCadence("tor-reconnected")).toBe(true);
    expect(canBypassCadence("online")).toBe(true);
    expect(canBypassCadence("interval")).toBe(false);
  });

  it("uses status age to schedule work without changing availability", () => {
    const now = 1_000_000;
    expect(shouldRefreshRobotStatus(undefined, now)).toBe(true);
    expect(shouldRefreshRobotStatus(now - PRO_RECONCILE_POLICY.statusFreshMs + 1, now)).toBe(false);
    expect(shouldRefreshRobotStatus(now - PRO_RECONCILE_POLICY.statusFreshMs, now)).toBe(true);
    expect(isRobotStatusStale(now - PRO_RECONCILE_POLICY.statusStaleMs + 1, now)).toBe(false);
    expect(isRobotStatusStale(now - PRO_RECONCILE_POLICY.statusStaleMs, now)).toBe(true);
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
