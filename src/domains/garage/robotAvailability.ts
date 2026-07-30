import type { RobotSlot } from "@/domains/garage/garageStore";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";

const pendingOrderActions = new Set<string>();

export type RobotOrderAvailability = {
  available: boolean;
  reason?: "busy" | "pending";
  message?: string;
};

export function isExpiredRenewableOrder(snapshot: ProTradeSnapshot): boolean {
  if (snapshot.order) {
    return snapshot.order.status === 5 && Boolean(snapshot.order.is_maker);
  }
  return snapshot.renewable;
}

export function getRobotOrderAvailability(
  slot: RobotSlot | undefined,
  snapshots: Record<string, ProTradeSnapshot> = {},
  options: { ignorePending?: boolean } = {}
): RobotOrderAvailability {
  if (!slot) return { available: false, reason: "busy", message: "Choose an available robot first." };
  if (!options.ignorePending && pendingOrderActions.has(slot.tokenSHA256)) {
    return { available: false, reason: "pending", message: `${slot.nickname} is already starting another order.` };
  }

  const renewableSnapshots = new Set(Object.values(snapshots)
    .filter((snapshot) =>
      snapshot.locator.slotId === slot.tokenSHA256
      && !snapshot.released
      && isExpiredRenewableOrder(snapshot)
    )
    .map((snapshot) => `${snapshot.locator.shortAlias}:${snapshot.locator.orderId}`));
  const robotReservations = Object.entries(slot.robots).map(([alias, robot]) => {
    const shortAlias = robot.shortAlias || alias;
    return {
      orderId: robot.activeOrderId,
      renewable: Boolean(robot.activeOrderId) && (
        robot.renewableOrderId === robot.activeOrderId
          || renewableSnapshots.has(`${shortAlias}:${robot.activeOrderId}`)
      )
    };
  });
  const reservedByRobot = robotReservations.some((reservation) =>
    reservation.orderId && !reservation.renewable
  );
  const slotActiveIsRenewable = Boolean(slot.activeOrderId) && robotReservations.some((reservation) =>
    reservation.orderId === slot.activeOrderId && reservation.renewable
  );
  const reservedByGarage = reservedByRobot || Boolean(slot.activeOrderId && !slotActiveIsRenewable);
  const reservedByTradeIndex = Object.values(snapshots).some((snapshot) =>
    snapshot.locator.slotId === slot.tokenSHA256
      && !snapshot.released
      && !isExpiredRenewableOrder(snapshot)
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
