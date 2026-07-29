import { describe, expect, it } from "vitest";
import {
  activityVolumeSeries,
  completedVolumeSeries,
  marketActivityComparisons,
  normalizeHistoricalPayload,
  normalizeTicksPayload,
  tickFiatAmount,
  volumeWeightedPremium
} from "@/domains/statistics/statisticsModel";

describe("statistics model", () => {
  it("normalizes historical records from the coordinator response shape", () => {
    expect(normalizeHistoricalPayload([
      { "2026-07-26": { volume: 0.25, num_contracts: 2 } },
      { invalid: { volume: 1, num_contracts: 1 } }
    ], "lake")).toEqual([
      { contracts: 2, coordinator: "lake", date: "2026-07-26", volumeBtc: 0.25 }
    ]);
  });

  it("combines coordinator history into exact daily buckets", () => {
    const points = completedVolumeSeries([
      { contracts: 2, coordinator: "lake", date: "2026-07-26", volumeBtc: 0.2 },
      { contracts: 1, coordinator: "temple", date: "2026-07-26", volumeBtc: 0.1 }
    ], "day", new Date("2026-07-26T12:00:00Z"));
    expect(points.at(-1)).toMatchObject({ contracts: 3, key: "2026-07-26" });
    expect(points.at(-1)?.volumeBtc).toBeCloseTo(0.3);
  });

  it("normalizes ticks and aggregates their activity separately", () => {
    const ticks = normalizeTicksPayload([
      { timestamp: "2026-07-26T10:03:00Z", currency: 2, volume: "0.01", price: "60000", premium: "3", fee: "0.00001" },
      { timestamp: "2026-07-26T10:08:00Z", currency: 2, volume: "0.02", price: "61000", premium: "4", fee: "0.00002" }
    ], "temple");
    expect(tickFiatAmount(ticks[1])).toBe(600);
    expect(activityVolumeSeries(ticks, "ten-minutes", new Date("2026-07-26T10:08:00Z")).at(-1))
      .toMatchObject({ contracts: 2, volumeBtc: 0.03 });
  });

  it("compares markets and calculates volume-weighted premiums", () => {
    const ticks = normalizeTicksPayload([
      { timestamp: "2026-07-26T10:03:00Z", currency: 1, volume: 0.01, premium: 2 },
      { timestamp: "2026-07-26T10:08:00Z", currency: 1, volume: 0.03, premium: 4 },
      { timestamp: "2026-07-26T10:09:00Z", currency: 2, volume: 0.02, premium: -1 }
    ], "temple");
    expect(volumeWeightedPremium(ticks)).toBeCloseTo(2);
    const comparisons = marketActivityComparisons(ticks);
    expect(comparisons[0]).toMatchObject({ activity: 2, currency: "USD", volumeBtc: 0.04 });
    expect(comparisons[0].averagePremium).toBeCloseTo(3.5);
    expect(comparisons[1]).toEqual({ activity: 1, averagePremium: -1, currency: "EUR", volumeBtc: 0.02 });
  });
});
