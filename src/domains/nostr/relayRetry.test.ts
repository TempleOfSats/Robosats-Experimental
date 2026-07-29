import { describe, expect, it } from "vitest";
import { RELAY_RETRY_DELAYS_MS, relayRetryDelay } from "@/domains/nostr/relayRetry";

describe("relay retry delay", () => {
  it("backs off repeated failures and caps the delay", () => {
    expect(RELAY_RETRY_DELAYS_MS.map((_delay, attempt) => relayRetryDelay(attempt, () => 0)))
      .toEqual([15_000, 45_000, 120_000, 300_000]);
    expect(relayRetryDelay(99, () => 0)).toBe(300_000);
  });

  it("adds bounded positive jitter", () => {
    expect(relayRetryDelay(0, () => 1)).toBe(18_000);
    expect(relayRetryDelay(0, () => -1)).toBe(15_000);
  });
});
