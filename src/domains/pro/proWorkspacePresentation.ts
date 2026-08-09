import { classifyProTrade, isResumableOrRenewableOffer } from "@/domains/pro/proSelectors";
import type { ProFilter } from "@/domains/pro/proPreferencesStore";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";
import type { OfferPreset } from "@/domains/pro/portableSettings";
import { isRobotStatusStale } from "@/domains/pro/reconcilePolicy";

export type ProDeadlineTone = "elapsed" | "quiet" | "soon" | "urgent";

export function summaryCounts(
  trades: ProTradeSnapshot[],
  rewardActionCount = 0
): Record<Exclude<ProFilter, "all">, number> {
  const counts = { "needs-action": rewardActionCount, active: 0, public: 0, renewable: 0 };
  for (const trade of trades) {
    const category = summaryCategory(trade);
    if (category) counts[category] += 1;
  }
  return counts;
}

export function summaryHasStale(trades: ProTradeSnapshot[], filter: Exclude<ProFilter, "all">): boolean {
  return trades.some(
    (trade) => (trade.freshness === "error" || trade.freshness === "stale") && summaryCategory(trade) === filter
  );
}

export function matchesFilter(snapshot: ProTradeSnapshot, filter: ProFilter): boolean {
  if (filter === "all") return true;
  return summaryCategory(snapshot) === filter;
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
  const prefix = isRobotStatusStale(value) ? "Last checked" : "Updated";
  if (elapsedMinutes < 60) return `${prefix} ${elapsedMinutes}m ago`;
  return `${prefix} ${Math.floor(elapsedMinutes / 60)}h ago`;
}

export function proDeadlineTone(deadline?: number, now = Date.now()): ProDeadlineTone {
  if (!deadline || !Number.isFinite(deadline)) return "quiet";
  const remaining = deadline - now;
  if (remaining <= 0) return "elapsed";
  if (remaining <= 30 * 60_000) return "urgent";
  if (remaining <= 2 * 60 * 60_000) return "soon";
  return "quiet";
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

function summaryCategory(snapshot: ProTradeSnapshot): Exclude<ProFilter, "all"> | undefined {
  if (isResumableOrRenewableOffer(snapshot)) return "renewable";
  if (snapshot.order?.status === 1 && snapshot.order.is_maker) return "public";
  if (classifyProTrade(snapshot) === "needs-action") return "needs-action";
  if (isActiveTrade(snapshot)) return "active";
  return undefined;
}
