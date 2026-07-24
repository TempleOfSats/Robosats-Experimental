import type { OrderDto } from "@/domains/orders/order.types";

export type ProSlotId = string;
export type ProTradeKey = `${ProSlotId}:${string}:${number}`;

export type ProTradeLocator = {
  slotId: ProSlotId;
  shortAlias: string;
  orderId: number;
};

export type SnapshotFreshness = "fresh" | "stale" | "refreshing" | "error";

export type ProTradeSnapshot = {
  key: ProTradeKey;
  locator: ProTradeLocator;
  nickname: string;
  hashId: string;
  order?: OrderDto;
  activeOrderId?: number;
  lastOrderId?: number;
  renewable: boolean;
  released: boolean;
  freshness: SnapshotFreshness;
  updatedAt?: number;
  changedAt?: number;
  errorCode?: string;
};

export type ReconcileReason =
  | "startup"
  | "fleet-ready"
  | "tor-ready"
  | "tor-reconnected"
  | "window-focus"
  | "visibility-resume"
  | "native-resume"
  | "online"
  | "nostr-hint"
  | "manual"
  | "interval"
  | "order-action"
  | "countdown-expiry";

export type SlotSyncState = {
  slotId: ProSlotId;
  epoch: number;
  inFlight: boolean;
  attemptedCoordinators?: number;
  locallyReadyAt?: number;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  nextEligibleAt?: number;
  error?: string;
};

export type OrderHint = {
  recipientPubkey: string;
  coordinatorPubkey: string;
  shortAlias?: string;
  orderId?: number;
  status?: number;
  eventId: string;
  createdAt: number;
};

export function proTradeKey(locator: ProTradeLocator): ProTradeKey {
  return `${locator.slotId}:${locator.shortAlias}:${locator.orderId}`;
}
