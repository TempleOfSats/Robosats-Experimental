import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import { getRobotOrderAvailability } from "@/domains/garage/robotAvailability";
import { garageReconciler } from "@/domains/pro/garageReconciler";
import { selectProGarageSlots, useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import {
  deriveProRobotLifecycle,
  proRobotStatusTimestamp
} from "@/domains/pro/proRobotLifecycle";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import { shouldRefreshRobotStatus } from "@/domains/pro/reconcilePolicy";
export {
  getRobotOrderAvailability,
  reserveRobotOrderAction,
  resetRobotOrderReservationsForTests
} from "@/domains/garage/robotAvailability";

export async function revalidateRobotForNewOrder({
  coordinator,
  proEnabled,
  slotId
}: {
  coordinator: CoordinatorSummary;
  proEnabled: boolean;
  slotId: string;
}): Promise<RobotSlot> {
  let slot = currentSlot(slotId);
  assertAvailable(slot, proEnabled);
  if (proEnabled) {
    const fleetSlots = selectProGarageSlots(
      useGarageStore.getState().slots,
      useGarageVaultStore.getState().manifest
    );
    if (!fleetSlots.some((item) => item.tokenSHA256 === slotId)) {
      throw new Error("Choose an available Fleet robot from the Pro Desk.");
    }
    const sync = useProTradeIndexStore.getState().syncBySlot[slotId];
    if (shouldRefreshRobotStatus(proRobotStatusTimestamp(sync))) {
      void garageReconciler.reconcileSlot(slotId, "order-action");
    }
    slot = currentSlot(slotId);
    assertAvailable(slot, true);
    return slot;
  }

  const result = await useGarageStore.getState().refreshRobotSlot(slot.token, [coordinator], {
    preferredAliases: [coordinator.shortAlias],
    priority: "foreground",
    source: "robot-refresh"
  });
  const coordinatorResult = result.coordinators.find((item) => item.shortAlias === coordinator.shortAlias);
  if (!coordinatorResult || coordinatorResult.error) {
    throw new Error(`Could not confirm ${slot.nickname}'s availability with ${coordinator.longAlias}. Try again.`);
  }

  slot = currentSlot(slotId);
  assertAvailable(slot, false);
  return slot;
}

function currentSlot(slotId: string): RobotSlot {
  const slot = useGarageStore.getState().slots.find((item) => item.tokenSHA256 === slotId);
  if (!slot) throw new Error("This robot is no longer available.");
  return slot;
}

function assertAvailable(slot: RobotSlot, proEnabled: boolean): void {
  const tradeIndex = useProTradeIndexStore.getState();
  const availability = proEnabled
    ? deriveProRobotLifecycle(
        slot,
        tradeIndex.snapshots,
        tradeIndex.syncBySlot[slot.tokenSHA256],
        { ignorePending: true }
      ).availability
    : getRobotOrderAvailability(slot, tradeIndex.snapshots, { ignorePending: true });
  if (!availability.available) throw new Error(availability.message);
}
