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

export type CoordinatorSettlementObservation = {
  slotId: string;
  shortAlias: string;
  orderId: number;
  purpose: "payout-received" | "escrow-paid";
  value: string;
};

type SettlementObservationListener = (observation: CoordinatorSettlementObservation) => void;

export type CoordinatorOrderActionActivity = {
  slotId: string;
  shortAlias: string;
  orderId: number;
} & (
  | { phase: "start" }
  | {
      phase: "complete";
      snapshotApplied: boolean;
    }
);

type OrderActionActivityListener = (activity: CoordinatorOrderActionActivity) => void;

const observations = new Map<string, CoordinatorOrderObservation>();
const listeners = new Set<OrderObservationListener>();
const settlementObservations = new Map<string, CoordinatorSettlementObservation>();
const settlementListeners = new Set<SettlementObservationListener>();
const orderActionListeners = new Set<OrderActionActivityListener>();

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
    isMaker: normalizedOrder.is_maker,
    isSeller: normalizedOrder.is_seller
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

export function recordCoordinatorSettlement(observation: CoordinatorSettlementObservation): void {
  const key = observationKey(observation.slotId, observation.shortAlias, observation.orderId);
  settlementObservations.delete(key);
  settlementObservations.set(key, observation);
  trimMap(settlementObservations);
  for (const listener of settlementListeners) notifySettlementListener(listener, observation);
}

export function subscribeCoordinatorSettlementActivity(
  listener: SettlementObservationListener,
  options: { replay?: boolean } = {}
): () => void {
  settlementListeners.add(listener);
  if (options.replay) replayCoordinatorSettlementActivity(listener);
  return () => settlementListeners.delete(listener);
}

export function replayCoordinatorSettlementActivity(listener: SettlementObservationListener): void {
  for (const observation of settlementObservations.values()) {
    notifySettlementListener(listener, observation);
  }
}

export function publishCoordinatorOrderActionActivity(activity: CoordinatorOrderActionActivity): void {
  for (const listener of orderActionListeners) notifyOrderActionListener(listener, activity);
}

export function subscribeCoordinatorOrderActionActivity(listener: OrderActionActivityListener): () => void {
  orderActionListeners.add(listener);
  return () => orderActionListeners.delete(listener);
}

export function resetCoordinatorOrderActivityForTests(): void {
  observations.clear();
  listeners.clear();
  settlementObservations.clear();
  settlementListeners.clear();
  orderActionListeners.clear();
}

function observationKey(slotId: string, shortAlias: string, orderId: number): string {
  return `${slotId}:${shortAlias}:${orderId}`;
}

function trimObservations(): void {
  trimMap(observations);
}

function trimMap<T>(records: Map<string, T>): void {
  while (records.size > MAX_OBSERVED_ORDERS) {
    const oldest = records.keys().next().value;
    if (!oldest) return;
    records.delete(oldest);
  }
}

function notifySettlementListener(
  listener: SettlementObservationListener,
  observation: CoordinatorSettlementObservation
): void {
  try {
    listener(observation);
  } catch {
    // Settlement indexing is repairable and cannot fail a coordinator action.
  }
}

function notifyListeners(observation: CoordinatorOrderObservation): void {
  for (const listener of listeners) notifyListener(listener, observation);
}

function notifyOrderActionListener(
  listener: OrderActionActivityListener,
  activity: CoordinatorOrderActionActivity
): void {
  try {
    listener(activity);
  } catch {
    // Reconciliation bookkeeping cannot fail a coordinator action.
  }
}

function notifyListener(listener: OrderObservationListener, observation: CoordinatorOrderObservation): void {
  try {
    listener(observation);
  } catch {
    // A presentation subscriber must not make a successful coordinator request fail.
  }
}
