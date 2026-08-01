export type NostrOrderChangeNotification = {
  source: "nostr";
  recipientPubkey: string;
  coordinatorPubkey: string;
  shortAlias: string;
  orderId: number;
  eventId: string;
  createdAt: number;
};

export type NativeOrderChangeNotification = {
  source: "native";
  shortAlias?: string;
  orderId?: number;
};

export type OrderChangeNotification = NostrOrderChangeNotification | NativeOrderChangeNotification;

type OrderChangeNotificationListener = (
  notification: OrderChangeNotification
) => boolean | void | Promise<boolean | void>;

type OrderChangeSubscription = {
  consumerId?: string;
  listener: OrderChangeNotificationListener;
};

type PendingOrderChange = {
  acknowledgedBy: Set<string>;
  deliveringTo: Set<string>;
  notification: OrderChangeNotification;
  publishedAt: number;
  replayRequestedBy: Set<string>;
};

const ORDER_CHANGE_TTL_MS = 60_000;
const MAX_PENDING_ORDER_CHANGES = 64;
const listeners = new Set<OrderChangeSubscription>();
const pendingChanges = new Map<string, PendingOrderChange>();
let pendingSequence = 0;

export function publishOrderChangeNotification(notification: OrderChangeNotification): void {
  purgePendingChanges();
  const key = `${orderChangeKey(notification)}:${++pendingSequence}`;
  const pending = {
    acknowledgedBy: new Set<string>(),
    deliveringTo: new Set<string>(),
    notification,
    publishedAt: Date.now(),
    replayRequestedBy: new Set<string>()
  };
  pendingChanges.set(key, pending);
  trimPendingChanges();
  const deliveredConsumers = new Set<string>();
  for (const subscription of listeners) {
    if (subscription.consumerId && deliveredConsumers.has(subscription.consumerId)) continue;
    if (subscription.consumerId) deliveredConsumers.add(subscription.consumerId);
    deliverOrderChange(key, pending, subscription);
  }
}

export function subscribeOrderChangeNotifications(
  listener: OrderChangeNotificationListener,
  options: { consumerId?: string; replayPending?: boolean } = {}
): () => void {
  const subscription = { consumerId: options.consumerId, listener };
  listeners.add(subscription);
  if (options.consumerId && options.replayPending !== false) {
    replayPendingOrderChangeNotifications(options.consumerId);
  }
  return () => listeners.delete(subscription);
}

export function replayPendingOrderChangeNotifications(consumerId: string): void {
  purgePendingChanges();
  const subscription = [...listeners].find((candidate) => candidate.consumerId === consumerId);
  if (!subscription) return;
  for (const [key, pending] of pendingChanges) {
    deliverOrderChange(key, pending, subscription, true);
  }
}

export function orderChangeMatches(
  notification: OrderChangeNotification,
  locator: { shortAlias?: string; orderId: number }
): boolean {
  if (notification.orderId !== undefined && notification.orderId !== locator.orderId) return false;
  return (
    notification.shortAlias === undefined ||
    locator.shortAlias === undefined ||
    notification.shortAlias === locator.shortAlias
  );
}

export function resetOrderChangeNotificationsForTests(): void {
  listeners.clear();
  pendingChanges.clear();
  pendingSequence = 0;
}

function deliverOrderChange(
  key: string,
  pending: PendingOrderChange,
  subscription: OrderChangeSubscription,
  replayRequested = false
): void {
  const { consumerId, listener } = subscription;
  if (consumerId && pending.acknowledgedBy.has(consumerId)) return;
  if (consumerId && pending.deliveringTo.has(consumerId)) {
    if (replayRequested) pending.replayRequestedBy.add(consumerId);
    return;
  }
  try {
    const acknowledged = listener(pending.notification);
    if (acknowledged === true) {
      acknowledgePendingChange(key, pending, consumerId);
      return;
    }
    if (acknowledged instanceof Promise) {
      if (consumerId) pending.deliveringTo.add(consumerId);
      void acknowledged
        .then((value) => {
          if (value === true) acknowledgePendingChange(key, pending, consumerId);
        })
        .catch(() => undefined)
        .finally(() => {
          if (pendingChanges.get(key) === pending && consumerId) {
            pending.deliveringTo.delete(consumerId);
            const replayAfterDelivery = pending.replayRequestedBy.delete(consumerId);
            if (replayAfterDelivery && !pending.acknowledgedBy.has(consumerId)) {
              const current = [...listeners].find((candidate) => candidate.consumerId === consumerId);
              if (current) deliverOrderChange(key, pending, current);
            }
          }
        });
    }
  } catch {
    // Refresh observers cannot break native or Nostr notification delivery.
  }
}

function acknowledgePendingChange(key: string, pending: PendingOrderChange, consumerId: string | undefined): void {
  if (!consumerId || pendingChanges.get(key) !== pending) return;
  pending.acknowledgedBy.add(consumerId);
}

function orderChangeKey(notification: OrderChangeNotification): string {
  if (notification.source === "nostr") {
    return `nostr:${notification.recipientPubkey}:${notification.shortAlias}:${notification.orderId}`;
  }
  return `native:${notification.shortAlias ?? "*"}:${notification.orderId ?? "*"}`;
}

function purgePendingChanges(): void {
  const cutoff = Date.now() - ORDER_CHANGE_TTL_MS;
  for (const [key, pending] of pendingChanges) {
    if (pending.publishedAt >= cutoff) continue;
    pendingChanges.delete(key);
  }
}

function trimPendingChanges(): void {
  while (pendingChanges.size > MAX_PENDING_ORDER_CHANGES) {
    const oldest = pendingChanges.keys().next().value;
    if (!oldest) return;
    pendingChanges.delete(oldest);
  }
}
