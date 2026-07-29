import { describe, expect, it } from "vitest";
import { CoordinatorRequestBackoff } from "@/domains/pro/coordinatorRequestBackoff";

describe("CoordinatorRequestBackoff", () => {
  it("opens after two failures and permits only one recovery probe", () => {
    const backoff = new CoordinatorRequestBackoff();

    expect(backoff.tryAcquire("lake", 1_000)).toBe(true);
    backoff.recordFailure("lake", 1_100);
    expect(backoff.tryAcquire("lake", 1_200)).toBe(true);
    backoff.recordFailure("lake", 1_300);

    expect(backoff.nextAttemptAt("lake")).toBe(121_300);
    expect(backoff.tryAcquire("lake", 120_000)).toBe(false);
    expect(backoff.tryAcquire("lake", 121_300)).toBe(true);
    expect(backoff.tryAcquire("lake", 121_301)).toBe(false);
  });

  it("does not escalate for concurrent failures from the wave that opened it", () => {
    const backoff = new CoordinatorRequestBackoff();

    backoff.recordFailure("lake", 1_000);
    backoff.recordFailure("lake", 1_100);
    backoff.recordFailure("lake", 1_200);

    expect(backoff.nextAttemptAt("lake")).toBe(121_100);
  });

  it("increases the delay after a failed recovery probe", () => {
    const backoff = new CoordinatorRequestBackoff();

    backoff.recordFailure("lake", 1_000);
    backoff.recordFailure("lake", 1_100);
    expect(backoff.tryAcquire("lake", 121_100)).toBe(true);
    backoff.recordFailure("lake", 121_200);

    expect(backoff.nextAttemptAt("lake")).toBe(421_200);
  });

  it("clears the circuit after any successful coordinator response", () => {
    const backoff = new CoordinatorRequestBackoff();

    backoff.recordFailure("lake", 1_000);
    backoff.recordFailure("lake", 1_100);
    backoff.recordSuccess("lake");

    expect(backoff.nextAttemptAt("lake")).toBeUndefined();
    expect(backoff.tryAcquire("lake", 1_200)).toBe(true);
  });

  it("allows foreground callers to bypass an open circuit", () => {
    const backoff = new CoordinatorRequestBackoff();

    backoff.recordFailure("lake", 1_000);
    backoff.recordFailure("lake", 1_100);

    expect(backoff.tryAcquire("lake", 2_000, true)).toBe(true);
    expect(backoff.tryAcquire("lake", 2_000)).toBe(false);
  });
});
