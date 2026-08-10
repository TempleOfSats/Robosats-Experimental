import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { orderSatsPreview } from "@/domains/orderbook/offerDisplay";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

export type LiquiditySide = "buy" | "sell";

export type LiquidityEntry = {
  currency: string;
  premium: number;
  side: LiquiditySide;
  volumeBtc: number;
};

export type LiquidityDepthPoint = {
  buyBtc: number;
  premium: number;
  sellBtc: number;
};

export type LiquidityMarket = {
  buyBtc: number;
  currency: string;
  offers: number;
  sellBtc: number;
};

type LiquidityCoordinator = Pick<CoordinatorSummary, "enabled" | "limits" | "shortAlias" | "url">;

export function missingLiquidityLimitAliases(
  orders: PublicOrder[],
  coordinators: LiquidityCoordinator[]
): string[] {
  const coordinatorByAlias = new Map(coordinators.map((coordinator) => [
    coordinator.shortAlias,
    coordinator
  ]));
  const aliases = new Set<string>();

  for (const order of orders) {
    const coordinator = coordinatorByAlias.get(order.coordinatorShortAlias);
    if (!coordinator?.enabled || !coordinator.url) continue;
    if (orderSatsPreview(order, coordinator.limits)) continue;
    aliases.add(coordinator.shortAlias);
  }

  return [...aliases].sort();
}

export function liquidityDepth(entries: LiquidityEntry[], range?: number): LiquidityDepthPoint[] {
  const visible = range === undefined
    ? entries
    : entries.filter((entry) => entry.premium >= -range && entry.premium <= range);
  if (visible.length === 0) return [];

  const observed = visible.map((entry) => entry.premium);
  const minimum = range === undefined ? Math.min(0, ...observed) : -range;
  const maximum = range === undefined ? Math.max(0, ...observed) : range;
  const premiums = [...new Set([minimum, 0, maximum, ...observed])].sort((left, right) => left - right);

  return premiums.map((premium) => ({
    buyBtc: sumVolume(visible, (entry) => entry.side === "buy" && entry.premium <= premium),
    premium,
    sellBtc: sumVolume(visible, (entry) => entry.side === "sell" && entry.premium >= premium)
  }));
}

export function liquidityMarkets(entries: LiquidityEntry[]): LiquidityMarket[] {
  const grouped = new Map<string, LiquidityMarket>();
  for (const entry of entries) {
    const market = grouped.get(entry.currency) ?? {
      buyBtc: 0,
      currency: entry.currency,
      offers: 0,
      sellBtc: 0
    };
    market.offers += 1;
    market[entry.side === "buy" ? "buyBtc" : "sellBtc"] += entry.volumeBtc;
    grouped.set(entry.currency, market);
  }
  return [...grouped.values()].sort(
    (left, right) => (right.buyBtc + right.sellBtc) - (left.buyBtc + left.sellBtc) || right.offers - left.offers
  );
}

export function liquidityOrderCounts(entries: LiquidityEntry[], premiums: Iterable<number>): Map<number, number> {
  const observed = entries.map((entry) => entry.premium).sort((left, right) => left - right);
  const counts = new Map<number, number>();
  let lower = 0;
  let upper = 0;
  for (const premium of [...premiums].sort((left, right) => left - right)) {
    while (lower < observed.length && observed[lower] <= premium - 0.000001) lower += 1;
    if (upper < lower) upper = lower;
    while (upper < observed.length && observed[upper] < premium + 0.000001) upper += 1;
    counts.set(premium, upper - lower);
  }
  return counts;
}

export function liquidityTotal(entries: LiquidityEntry[], side: LiquiditySide): number {
  return sumVolume(entries, (entry) => entry.side === side);
}

export function weightedLiquidityPremium(entries: LiquidityEntry[]): number | undefined {
  const volume = entries.reduce((total, entry) => total + entry.volumeBtc, 0);
  if (volume <= 0) return undefined;
  return entries.reduce((total, entry) => total + entry.premium * entry.volumeBtc, 0) / volume;
}

function sumVolume(entries: LiquidityEntry[], predicate: (entry: LiquidityEntry) => boolean): number {
  return entries.reduce((total, entry) => total + (predicate(entry) ? entry.volumeBtc : 0), 0);
}
