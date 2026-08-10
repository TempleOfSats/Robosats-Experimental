import { describe, expect, it } from "vitest";
import {
  liquidityDepth,
  liquidityMarkets,
  liquidityOrderCounts,
  liquidityTotal,
  missingLiquidityLimitAliases,
  weightedLiquidityPremium,
  type LiquidityEntry
} from "@/domains/statistics/liquidityModel";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

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

  it("counts offers at each observed premium in one pass", () => {
    const counts = liquidityOrderCounts(
      [...entries, entries[0], { ...entries[0], premium: 1.0000005 }],
      [-2, 0, 1]
    );

    expect(counts.get(1)).toBe(3);
    expect(counts.get(-2)).toBe(1);
    expect(counts.get(0)).toBe(0);
  });

  it("requests only coordinator limits needed to price public orders", () => {
    const orders = [
      publicOrder({ coordinatorShortAlias: "lake", satoshis: 0 }),
      publicOrder({ coordinatorShortAlias: "temple", satoshis: 50_000 }),
      publicOrder({ coordinatorShortAlias: "offline", satoshis: 0 })
    ];

    expect(missingLiquidityLimitAliases(orders, [
      { shortAlias: "lake", enabled: true, url: "http://lake.onion" },
      { shortAlias: "temple", enabled: true, url: "http://temple.onion" },
      { shortAlias: "offline", enabled: false, url: "http://offline.onion" }
    ])).toEqual(["lake"]);
  });

  it("does not refetch limits when the order can already be priced", () => {
    expect(missingLiquidityLimitAliases([
      publicOrder({ coordinatorShortAlias: "lake", satoshis: 0 })
    ], [{
      shortAlias: "lake",
      enabled: true,
      url: "http://lake.onion",
      limits: {
        "1": {
          code: "USD",
          price: 50_000,
          min_amount: 10,
          max_amount: 1_000
        }
      }
    }])).toEqual([]);
  });
});

function publicOrder(values: Partial<PublicOrder> = {}): PublicOrder {
  return {
    id: 1,
    type: 0,
    currency: 1,
    currencyCode: "USD",
    amount: 100,
    has_range: false,
    is_swap: false,
    min_amount: 0,
    max_amount: 0,
    payment_method: "SEPA",
    premium: 0,
    satoshis: 0,
    maker_nick: "Robot",
    maker_hash_id: "hash",
    bond_size_sats: 0,
    coordinatorShortAlias: "lake",
    ...values
  };
}
