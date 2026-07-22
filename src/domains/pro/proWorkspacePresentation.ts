import { classifyProTrade } from "@/domains/pro/proSelectors";
import type { ProFilter } from "@/domains/pro/proPreferencesStore";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";
import type { OfferPreset } from "@/domains/pro/portableSettings";

export function summaryCounts(trades: ProTradeSnapshot[]): Record<Exclude<ProFilter, "all">, number> {
  return {
    "needs-action": trades.filter((trade) => classifyProTrade(trade) === "needs-action").length,
    active: trades.filter((trade) => isActiveTrade(trade)).length,
    public: trades.filter((trade) => trade.order?.status === 1 && trade.order.is_maker).length,
    renewable: trades.filter((trade) => trade.renewable).length
  };
}

export function summaryHasStale(trades: ProTradeSnapshot[], filter: Exclude<ProFilter, "all">): boolean {
  return trades.some((trade) => {
    if (trade.freshness !== "error" && trade.freshness !== "stale") return false;
    if (filter === "needs-action") return classifyProTrade({ ...trade, freshness: "fresh" }) === "needs-action";
    if (filter === "active") return isActiveTrade(trade);
    if (filter === "public") return trade.order?.status === 1 && trade.order.is_maker;
    return trade.renewable;
  });
}

export function matchesFilter(snapshot: ProTradeSnapshot, filter: ProFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs-action") return classifyProTrade(snapshot) === "needs-action";
  if (filter === "active") return isActiveTrade(snapshot);
  if (filter === "public") return snapshot.order?.status === 1 && snapshot.order.is_maker;
  return snapshot.renewable;
}

export function groupLabel(group: ReturnType<typeof classifyProTrade>): string {
  if (group === "needs-action") return "Needs action";
  if (group === "in-progress") return "In progress";
  if (group === "waiting") return "Waiting and public";
  if (group === "renewable") return "Renewable";
  return "Refresh needed";
}

export function formatLastRefresh(value?: number): string {
  if (!value) return "Not refreshed";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (elapsedMinutes < 1) return "Updated now";
  if (elapsedMinutes < 60) return `Updated ${elapsedMinutes}m ago`;
  return `Updated ${Math.floor(elapsedMinutes / 60)}h ago`;
}

export function uniquePresetName(candidate: string, presets: OfferPreset[]): string {
  const names = new Set(presets.map((preset) => preset.name.toLowerCase()));
  if (!names.has(candidate.toLowerCase())) return candidate;
  let suffix = 2;
  while (names.has(`${candidate} ${suffix}`.toLowerCase())) suffix += 1;
  return `${candidate} ${suffix}`;
}

function isActiveTrade(snapshot: ProTradeSnapshot): boolean {
  const status = snapshot.order?.status;
  return status != null && status >= 3 && ![4, 5, 12, 14, 17, 18].includes(status);
}
