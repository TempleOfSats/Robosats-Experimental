import type { RobotSlot } from "@/domains/garage/garageStore";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";

const pendingOrderActions = new Set<string>();

export type RobotOrderAvailability = {
  available: boolean;
  reason?: "busy" | "pending";
  message?: string;
};

export function getRobotOrderAvailability(
  slot: RobotSlot | undefined,
  snapshots: Record<string, ProTradeSnapshot> = {},
  options: { ignorePending?: boolean } = {}
): RobotOrderAvailability {
  if (!slot) return { available: false, reason: "busy", message: "Choose an available robot first." };
  if (!options.ignorePending && pendingOrderActions.has(slot.tokenSHA256)) {
    return { available: false, reason: "pending", message: `${slot.nickname} is already starting another order.` };
  }

  const reservedByGarage = Boolean(slot.activeOrderId) || Object.values(slot.robots).some((robot) =>
    Boolean(robot.activeOrderId || robot.renewableOrderId)
  );
  const reservedByTradeIndex = Object.values(snapshots).some((snapshot) =>
    snapshot.locator.slotId === slot.tokenSHA256 && !snapshot.released
  );
  if (reservedByGarage || reservedByTradeIndex) {
    return {
      available: false,
      reason: "busy",
      message: `${slot.nickname} already has an order. Finish it before starting another.`
    };
  }
  return { available: true };
}

export function reserveRobotOrderAction(slotId: string): (() => void) | undefined {
  if (pendingOrderActions.has(slotId)) return undefined;
  pendingOrderActions.add(slotId);
  return () => pendingOrderActions.delete(slotId);
}

export function resetRobotOrderReservationsForTests(): void {
  pendingOrderActions.clear();
}
