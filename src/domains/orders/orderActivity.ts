import type { RobotSlot } from "@/domains/garage/garageStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import type { OrderDto } from "@/domains/orders/order.types";

const MAX_OBSERVED_ORDERS = 32;

export type CoordinatorOrderObservation = {
  slotId: string;
  shortAlias: string;
  order: OrderDto;
  authoritative: boolean;
  observedAt: number;
};

type OrderObservationListener = (observation: CoordinatorOrderObservation) => void;

const observations = new Map<string, CoordinatorOrderObservation>();
const listeners = new Set<OrderObservationListener>();

export function ingestCoordinatorOrder({
  authoritative = true,
  order,
  orderId,
  shortAlias,
  slot
}: {
  authoritative?: boolean;
  order: OrderDto;
  orderId?: number;
  shortAlias: string;
  slot?: RobotSlot;
}): OrderDto {
  const resolvedOrderId = order.id || orderId || 0;
  const normalizedOrder = { ...order, id: resolvedOrderId, shortAlias };
  if (!slot || resolvedOrderId <= 0) return normalizedOrder;

  const key = observationKey(slot.tokenSHA256, shortAlias, resolvedOrderId);
  const previous = observations.get(key);
  if (!authoritative && previous?.authoritative) return normalizedOrder;

  useGarageStore.getState().syncOrderSnapshot({
    token: slot.token,
    shortAlias,
    orderId: resolvedOrderId,
    status: normalizedOrder.status,
    isMaker: normalizedOrder.is_maker
  });

  const observation: CoordinatorOrderObservation = {
    slotId: slot.tokenSHA256,
    shortAlias,
    order: normalizedOrder,
    authoritative,
    observedAt: Date.now()
  };
  observations.delete(key);
  observations.set(key, observation);
  trimObservations();
  notifyListeners(observation);
  return normalizedOrder;
}

export function subscribeCoordinatorOrderActivity(
  listener: OrderObservationListener,
  options: { replay?: boolean } = {}
): () => void {
  listeners.add(listener);
  if (options.replay) replayCoordinatorOrderActivity(listener);
  return () => listeners.delete(listener);
}

export function replayCoordinatorOrderActivity(listener: OrderObservationListener): void {
  for (const observation of observations.values()) notifyListener(listener, observation);
}

export function resetCoordinatorOrderActivityForTests(): void {
  observations.clear();
  listeners.clear();
}

function observationKey(slotId: string, shortAlias: string, orderId: number): string {
  return `${slotId}:${shortAlias}:${orderId}`;
}

function trimObservations(): void {
  while (observations.size > MAX_OBSERVED_ORDERS) {
    const oldest = observations.keys().next().value;
    if (!oldest) return;
    observations.delete(oldest);
  }
}

function notifyListeners(observation: CoordinatorOrderObservation): void {
  for (const listener of listeners) notifyListener(listener, observation);
}

function notifyListener(listener: OrderObservationListener, observation: CoordinatorOrderObservation): void {
  try {
    listener(observation);
  } catch {
    // A presentation subscriber must not make a successful coordinator request fail.
  }
}
