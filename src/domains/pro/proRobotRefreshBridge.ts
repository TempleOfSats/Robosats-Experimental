import {
  subscribeRobotRefreshResults,
  type RefreshRobotSlotResult
} from "@/domains/garage/robotRefreshEvents";
import { selectProGarageSlots, useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import type { ProSlotId, SlotSyncState } from "@/domains/pro/pro.types";

export function startProRobotRefreshBridge(): () => void {
  return subscribeRobotRefreshResults((result) => {
    recordProRobotRefreshResult(result);
  });
}

export function recordProRobotRefreshResult(
  result: RefreshRobotSlotResult,
  completedAt = Date.now()
): void {
  if (!isActiveFleetSlot(result.slotId)) return;

  const tradeIndex = useProTradeIndexStore.getState();
  const previous = tradeIndex.syncBySlot[result.slotId];
  const attempted = result.coordinators.filter((coordinator) => !coordinator.cached);
  if (attempted.length === 0 && result.coordinators.length > 0) return;
  const attemptedCoordinators = attempted.length;
  const failedCoordinators = attempted.filter((coordinator) => coordinator.error).length;
  const successfulCoordinators = attemptedCoordinators - failedCoordinators;

  tradeIndex.setSlotSync({
    ...previous,
    slotId: result.slotId,
    epoch: previous?.epoch ?? 0,
    inFlight: previous?.inFlight ?? false,
    attemptedCoordinators,
    lastAttemptAt: completedAt,
    lastSuccessAt: successfulCoordinators > 0 ? completedAt : previous?.lastSuccessAt,
    error: refreshError(attemptedCoordinators, successfulCoordinators, failedCoordinators)
  });
}

export function slotsNeedingCoordinatorRetry(
  slotIds: string[],
  syncBySlot: Record<ProSlotId, SlotSyncState>
): string[] {
  return slotIds.filter((slotId) => {
    const sync = syncBySlot[slotId];
    return sync?.attemptedCoordinators === 0
      && !sync.lastSuccessAt
      && !sync.inFlight;
  });
}

function isActiveFleetSlot(slotId: string): boolean {
  return selectProGarageSlots(
    useGarageStore.getState().slots,
    useGarageVaultStore.getState().manifest
  ).some((slot) => slot.tokenSHA256 === slotId);
}

function refreshError(
  attemptedCoordinators: number,
  successfulCoordinators: number,
  failedCoordinators: number
): string | undefined {
  if (attemptedCoordinators === 0 || failedCoordinators === 0) return undefined;
  return successfulCoordinators > 0 ? "partial-failure" : "refresh-failed";
}
