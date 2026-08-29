import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import { getRobotOrderAvailability } from "@/domains/garage/robotAvailability";
// The Pro/Fleet vault stack is only needed while a robot is actually being
// reserved or revalidated. Load it on demand so order routes never pull the
// vault, its crypto, or its sync records into their static request graph.
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
  if (proEnabled) {
    const [{ selectProGarageSlots, useGarageVaultStore }, { deriveProRobotLifecycle, proRobotStatusTimestamp }, { useProTradeIndexStore }, { shouldRefreshRobotStatus }, { garageReconciler }] =
      await Promise.all([
        import("@/domains/pro/garageVaultStore"),
        import("@/domains/pro/proRobotLifecycle"),
        import("@/domains/pro/proTradeIndexStore"),
        import("@/domains/pro/reconcilePolicy"),
        import("@/domains/pro/garageReconciler")
      ]);
    let tradeIndex = useProTradeIndexStore.getState();
    assertAvailable(
      deriveProRobotLifecycle(slot, tradeIndex.snapshots, tradeIndex.syncBySlot[slotId], { ignorePending: true })
        .availability
    );
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
    tradeIndex = useProTradeIndexStore.getState();
    assertAvailable(
      deriveProRobotLifecycle(slot, tradeIndex.snapshots, tradeIndex.syncBySlot[slotId], { ignorePending: true })
        .availability
    );
    return slot;
  }

  const { useProTradeIndexStore } = await import("@/domains/pro/proTradeIndexStore");
  assertAvailable(
    getRobotOrderAvailability(slot, useProTradeIndexStore.getState().snapshots, { ignorePending: true })
  );
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
  assertAvailable(
    getRobotOrderAvailability(slot, useProTradeIndexStore.getState().snapshots, { ignorePending: true })
  );
  return slot;
}

function currentSlot(slotId: string): RobotSlot {
  const slot = useGarageStore.getState().slots.find((item) => item.tokenSHA256 === slotId);
  if (!slot) throw new Error("This robot is no longer available.");
  return slot;
}

function assertAvailable(availability: ReturnType<typeof getRobotOrderAvailability>): void {
  if (!availability.available) throw new Error(availability.message);
}
