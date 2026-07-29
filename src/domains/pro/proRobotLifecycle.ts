import type { RobotSlot } from "@/domains/garage/garageStore";
import {
  getRobotOrderAvailability,
  type RobotOrderAvailability
} from "@/domains/garage/robotAvailability";
import {
  classifyProTrade,
  isResumableOrRenewableOffer,
  type ProRobotSummary
} from "@/domains/pro/proSelectors";
import type {
  ProTradeSnapshot,
  SlotSyncState
} from "@/domains/pro/pro.types";

export type ProRobotLifecycleStatus =
  | "ready"
  | "checking"
  | "waiting"
  | "unavailable"
  | "starting"
  | "renewable"
  | "ongoing"
  | "needs-attention";

export type ProRobotVerification =
  | "local"
  | "coordinator"
  | "checking"
  | "waiting"
  | "unavailable"
  | "unknown";

export type ProRobotLifecycle = {
  status: ProRobotLifecycleStatus;
  verification: ProRobotVerification;
  statusLabel: string;
  statusTone: "default" | "success" | "warning" | "muted";
  statusTimestamp?: number;
  availability: RobotOrderAvailability;
  canStartOrder: boolean;
  canRemove: boolean;
  canOpenTrade: boolean;
};

export type OfferReadyRobots = ReturnType<typeof selectOfferReadyRobots>;

export function deriveProRobotLifecycle(
  slot: RobotSlot,
  snapshots: Record<string, ProTradeSnapshot>,
  sync?: SlotSyncState,
  options: { ignorePending?: boolean } = {}
): ProRobotLifecycle {
  const availability = getRobotOrderAvailability(slot, snapshots, options);
  const trades = Object.values(snapshots).filter((snapshot) =>
    snapshot.locator.slotId === slot.tokenSHA256 && !snapshot.released
  );
  const needsAttention = trades.some((snapshot) => classifyProTrade(snapshot) === "needs-action");

  if (availability.reason === "pending") {
    return lifecycle("starting", "unknown", "Starting order", "default", availability, sync);
  }
  if (needsAttention) {
    return lifecycle("needs-attention", verification(sync), "Needs attention", "warning", availability, sync, true);
  }
  if (trades.some(isResumableOrRenewableOffer)) {
    return lifecycle("renewable", verification(sync), "Renewable trade", "default", availability, sync, true);
  }
  const unresolvedOrder = trades.find((snapshot) => !snapshot.order);
  if (unresolvedOrder && trades.every((snapshot) => !snapshot.order)) {
    if (unresolvedOrder.freshness === "refreshing") {
      return lifecycle("checking", "checking", "Checking last order", "muted", availability, sync);
    }
    return lifecycle("unavailable", "unavailable", "Order status unavailable", "muted", availability, sync);
  }
  if (!availability.available || trades.length > 0) {
    return lifecycle("ongoing", verification(sync), "Ongoing trade", "default", availability, sync, true);
  }

  const confidence = verification(sync);
  if (confidence === "checking") {
    return lifecycle("checking", confidence, "Checking status", "muted", availability, sync);
  }
  if (confidence === "waiting") {
    return lifecycle("waiting", confidence, "Waiting for coordinators", "muted", availability, sync);
  }
  if (confidence === "unavailable") {
    return lifecycle("unavailable", confidence, "Status unavailable", "muted", availability, sync);
  }
  return lifecycle("ready", confidence, "Ready", "success", availability, sync);
}

export function selectOfferReadyRobots(
  slots: RobotSlot[],
  summaries: ProRobotSummary[],
  snapshots: Record<string, ProTradeSnapshot>
): ProRobotSummary[] {
  const summariesById = new Map(summaries.map((summary) => [summary.slotId, summary]));
  return slots.flatMap((slot) => {
    const summary = summariesById.get(slot.tokenSHA256);
    if (!summary || !deriveProRobotLifecycle(slot, snapshots).canStartOrder) return [];
    return [summary];
  });
}

export function hasProRobotStatusBaseline(sync?: SlotSyncState): boolean {
  return Boolean(proRobotStatusTimestamp(sync));
}

export function proRobotStatusTimestamp(sync?: SlotSyncState): number | undefined {
  if (!sync?.lastSuccessAt) return sync?.locallyReadyAt;
  if (!sync.locallyReadyAt) return sync.lastSuccessAt;
  return Math.max(sync.lastSuccessAt, sync.locallyReadyAt);
}

function lifecycle(
  status: ProRobotLifecycleStatus,
  confidence: ProRobotVerification,
  statusLabel: string,
  statusTone: ProRobotLifecycle["statusTone"],
  availability: RobotOrderAvailability,
  sync: SlotSyncState | undefined,
  canOpenTrade = false
): ProRobotLifecycle {
  return {
    status,
    verification: confidence,
    statusLabel,
    statusTone,
    statusTimestamp: proRobotStatusTimestamp(sync),
    availability,
    canStartOrder: availability.available,
    canRemove: availability.available,
    canOpenTrade
  };
}

function verification(sync?: SlotSyncState): ProRobotVerification {
  if (sync?.lastSuccessAt) return "coordinator";
  if (sync?.locallyReadyAt) return "local";
  if (!sync?.lastAttemptAt || sync.inFlight) return "checking";
  if (sync.attemptedCoordinators === 0) return "waiting";
  if (Boolean(sync.attemptedCoordinators) && sync.error === "refresh-failed") return "unavailable";
  return "unknown";
}
