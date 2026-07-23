import { beforeEach, describe, expect, it } from "vitest";
import {
  clearNetworkPerformance,
  networkPerformanceSnapshot,
  recordNetworkPerformance,
  recordRelayPerformance
} from "@/domains/diagnostics/networkPerformance";

beforeEach(clearNetworkPerformance);

describe("network performance diagnostics", () => {
  it("keeps only the latest 250 privacy-safe entries", () => {
    for (let index = 0; index < 260; index += 1) {
      recordNetworkPerformance({
        origin: "https://coordinator.example",
        source: "robot-refresh",
        totalMs: index,
        outcome: "success"
      });
    }

    const snapshot = networkPerformanceSnapshot();
    expect(snapshot).toHaveLength(250);
    expect(snapshot[0].totalMs).toBe(10);
    expect(snapshot[0].originHash).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(snapshot)).not.toContain("coordinator.example");
  });

  it("records relay phases without retaining relay URLs", () => {
    recordRelayPerformance("wss://relay.example/relay", "first-event", 420);
    expect(networkPerformanceSnapshot()).toEqual([
      expect.objectContaining({
        source: "nostr",
        relayPhase: "first-event",
        totalMs: 420,
        outcome: "success"
      })
    ]);
    expect(JSON.stringify(networkPerformanceSnapshot())).not.toContain("relay.example");
  });
});
