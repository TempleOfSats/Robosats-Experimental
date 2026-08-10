import type { RobotSlot } from "@/domains/garage/garageStore";
import { getTradeViewState, hasActionableOrderDeadline } from "@/domains/orders/orderStateMachine";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";

export type ProTradeGroup = "needs-action" | "in-progress" | "waiting" | "renewable" | "stale";

export type ProRobotSummary = {
  slotId: string;
  nickname: string;
  hashId: string;
  coordinatorCount: number;
  activeTradeCount: number;
  publicOfferCount: number;
  needsAttentionCount: number;
  relevantOrderCount: number;
  stale: boolean;
  previouslyUsed?: boolean;
};

const actionable = new Set([
  "pay_bond",
  "pay_escrow",
  "submit_payout",
  "chat",
  "submit_statement",
  "retry_invoice"
]);

export function classifyProTrade(snapshot: ProTradeSnapshot): ProTradeGroup {
  if (snapshot.freshness === "error" || snapshot.freshness === "stale") return "stale";
  if (isResumableOrRenewableOffer(snapshot)) return "renewable";
  if (!snapshot.order) return "stale";
  const view = getTradeViewState(snapshot.order);
  if (actionable.has(view.requiredAction)) return "needs-action";
  if (snapshot.order.status === 1 || snapshot.order.status === 2 || snapshot.order.status === 3) return "waiting";
  return "in-progress";
}

export function isResumableOrRenewableOffer(snapshot: ProTradeSnapshot): boolean {
  return snapshot.renewable || Boolean(snapshot.order?.status === 2 && snapshot.order.is_maker);
}

export function compareProTrades(left: ProTradeSnapshot, right: ProTradeSnapshot): number {
  const groups: Record<ProTradeGroup, number> = {
    "needs-action": 0,
    "in-progress": 1,
    waiting: 2,
    renewable: 3,
    stale: 4
  };
  const groupDifference = groups[classifyProTrade(left)] - groups[classifyProTrade(right)];
  if (groupDifference) return groupDifference;

  const deadlineDifference = deadline(left) - deadline(right);
  if (deadlineDifference) return deadlineDifference;
  const changedDifference = (right.changedAt ?? 0) - (left.changedAt ?? 0);
  if (changedDifference) return changedDifference;
  const refreshedDifference = (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
  if (refreshedDifference) return refreshedDifference;
  const robotDifference = left.nickname.localeCompare(right.nickname);
  if (robotDifference) return robotDifference;
  const coordinatorDifference = left.locator.shortAlias.localeCompare(right.locator.shortAlias);
  return coordinatorDifference || left.locator.orderId - right.locator.orderId;
}

export function selectRelevantTrades(snapshots: Record<string, ProTradeSnapshot>): ProTradeSnapshot[] {
  return Object.values(snapshots).filter((snapshot) => !snapshot.released).sort(compareProTrades);
}

export function summarizeProRobots(
  slots: RobotSlot[],
  snapshots: Record<string, ProTradeSnapshot>
): ProRobotSummary[] {
  const bySlot = new Map<string, ProTradeSnapshot[]>();
  for (const snapshot of Object.values(snapshots)) {
    const entries = bySlot.get(snapshot.locator.slotId) ?? [];
    entries.push(snapshot);
    bySlot.set(snapshot.locator.slotId, entries);
  }

  return slots.map((slot) => {
    const trades = bySlot.get(slot.tokenSHA256) ?? [];
    return {
      slotId: slot.tokenSHA256,
      nickname: slot.nickname,
      hashId: slot.hashId,
      coordinatorCount: Object.keys(slot.robots).filter((alias) => alias !== "local").length,
      activeTradeCount: trades.filter((trade) => !trade.released && !trade.renewable).length,
      publicOfferCount: trades.filter((trade) => trade.order?.status === 1 && trade.order.is_maker).length,
      needsAttentionCount: trades.filter((trade) => classifyProTrade(trade) === "needs-action").length,
      relevantOrderCount: trades.filter((trade) => !trade.released).length,
      stale: trades.some((trade) => trade.freshness === "error" || trade.freshness === "stale"),
      previouslyUsed: Boolean(slot.lastOrderId)
        || Object.values(slot.robots).some((robot) => Boolean(robot.lastOrderId || robot.releasedOrderId))
    };
  });
}

function deadline(snapshot: ProTradeSnapshot): number {
  if (!snapshot.order || !hasActionableOrderDeadline(snapshot.order)) return Number.POSITIVE_INFINITY;
  const parsed = snapshot.order?.expires_at ? Date.parse(snapshot.order.expires_at) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
