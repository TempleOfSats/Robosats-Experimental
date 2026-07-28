import { describe, expect, it } from "vitest";
import {
  liquidityDepth,
  liquidityMarkets,
  liquidityTotal,
  weightedLiquidityPremium,
  type LiquidityEntry
} from "@/domains/statistics/liquidityModel";

const entries: LiquidityEntry[] = [
  { currency: "USD", premium: 1, side: "buy", volumeBtc: 0.1 },
  { currency: "USD", premium: 3, side: "buy", volumeBtc: 0.2 },
  { currency: "USD", premium: -2, side: "sell", volumeBtc: 0.4 },
  { currency: "EUR", premium: -4, side: "sell", volumeBtc: 0.3 }
];

describe("liquidity model", () => {
  it("builds opposing cumulative premium curves", () => {
    const points = liquidityDepth(entries, 5);
    expect(points[0]).toEqual({ buyBtc: 0, premium: -5, sellBtc: 0.7 });
    expect(points.find((point) => point.premium === 0)).toEqual({ buyBtc: 0, premium: 0, sellBtc: 0 });
    expect(points.at(-1)?.buyBtc).toBeCloseTo(0.3);
    expect(points.at(-1)).toMatchObject({ premium: 5, sellBtc: 0 });
  });

  it("summarizes liquidity by side and market", () => {
    expect(liquidityTotal(entries, "buy")).toBeCloseTo(0.3);
    expect(liquidityMarkets(entries)[0].buyBtc).toBeCloseTo(0.3);
    expect(liquidityMarkets(entries)[0]).toMatchObject({ currency: "USD", offers: 3, sellBtc: 0.4 });
    expect(weightedLiquidityPremium(entries)).toBeCloseTo(-1.3);
  });
});
