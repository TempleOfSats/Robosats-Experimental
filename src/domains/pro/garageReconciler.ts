import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import {
  getRobotAuthForCoordinator,
  type RefreshRobotCoordinatorResult,
  type RefreshRobotSlotResult,
  type RobotSlot,
  useGarageStore
} from "@/domains/garage/garageStore";
import { fetchOrder } from "@/domains/orders/orderApi";
import { isAlreadyCancelledError } from "@/domains/orders/orderStore";
import type { OrderDto } from "@/domains/orders/order.types";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import {
  type OrderHint,
  type ProTradeLocator,
  type ProTradeSnapshot,
  type ReconcileReason,
  proTradeKey
} from "@/domains/pro/pro.types";
import { canBypassCadence, jitteredDelay, mapWithConcurrency, PRO_RECONCILE_POLICY } from "@/domains/pro/reconcilePolicy";

type GarageReconcilerDependencies = {
  now: () => number;
  getSlots: () => RobotSlot[];
  getCoordinators: () => CoordinatorSummary[];
  refreshRobotSlot: (token: string, coordinators: CoordinatorSummary[]) => Promise<RefreshRobotSlotResult>;
  fetchOrder: (coordinator: CoordinatorSummary, orderId: number, slot: RobotSlot) => Promise<OrderDto>;
};

export interface GarageReconcileController {
  reconcileAll(reason: ReconcileReason): Promise<void>;
  reconcileSlot(slotId: string, reason: ReconcileReason): Promise<void>;
  reconcileOrder(locator: ProTradeLocator, reason: ReconcileReason): Promise<void>;
  handleOrderHint(hint: OrderHint): Promise<void>;
  invalidateEpoch(): void;
}

class AsyncLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

export class GarageReconciler implements GarageReconcileController {
  private epoch = 0;
  private readonly inFlightSlots = new Map<string, Promise<void>>();
  private readonly orderLimiter = new AsyncLimiter(PRO_RECONCILE_POLICY.maxOrderRequests);
  private readonly handledHintIds = new Set<string>();

  constructor(private readonly dependencies: GarageReconcilerDependencies) {}

  async reconcileAll(reason: ReconcileReason): Promise<void> {
    const slots = prioritizeSlots(this.dependencies.getSlots());
    await mapWithConcurrency(slots, PRO_RECONCILE_POLICY.maxRobotRequests, (slot) =>
      this.reconcileSlot(slot.tokenSHA256, reason)
    );
  }

  async reconcileSlot(slotId: string, reason: ReconcileReason): Promise<void> {
    const existing = this.inFlightSlots.get(slotId);
    if (existing) return existing;

    const sync = useProTradeIndexStore.getState().syncBySlot[slotId];
    const now = this.dependencies.now();
    if (!canBypassCadence(reason) && sync?.nextEligibleAt && sync.nextEligibleAt > now) return;

    const refresh = this.performSlotReconcile(slotId, reason).finally(() => {
      if (this.inFlightSlots.get(slotId) === refresh) this.inFlightSlots.delete(slotId);
    });
    this.inFlightSlots.set(slotId, refresh);
    return refresh;
  }

  async reconcileOrder(locator: ProTradeLocator, reason: ReconcileReason): Promise<void> {
    const slot = this.dependencies.getSlots().find((item) => item.tokenSHA256 === locator.slotId);
    const coordinator = this.dependencies.getCoordinators().find((item) => item.shortAlias === locator.shortAlias);
    if (!slot || !coordinator?.url || !coordinator.enabled) return;
    await this.refreshOrder(slot, coordinator, locator, undefined, reason, this.epoch);
  }

  async handleOrderHint(hint: OrderHint): Promise<void> {
    const slot = this.dependencies.getSlots().find((item) => item.nostrPubKey === hint.recipientPubkey);
    const coordinator = this.dependencies.getCoordinators().find((item) =>
      item.enabled && item.nostrHexPubkey?.toLowerCase() === hint.coordinatorPubkey.toLowerCase()
    );
    if (!slot || !coordinator || this.handledHintIds.has(hint.eventId) || !isRecentHint(hint, this.dependencies.now())) return;
    if (hint.shortAlias && hint.shortAlias !== coordinator.shortAlias) return;
    this.rememberHint(hint.eventId);
    const normalizedHint = { ...hint, shortAlias: coordinator.shortAlias };
    useProTradeIndexStore.getState().markDirtyByNostr(slot.tokenSHA256, normalizedHint);
    if (hint.orderId) {
      await this.reconcileOrder({ slotId: slot.tokenSHA256, shortAlias: coordinator.shortAlias, orderId: hint.orderId }, "nostr-hint");
      return;
    }
    await this.reconcileSlot(slot.tokenSHA256, "nostr-hint");
  }

  invalidateEpoch(): void {
    this.epoch += 1;
  }

  private rememberHint(eventId: string): void {
    this.handledHintIds.add(eventId);
    if (this.handledHintIds.size <= 2048) return;
    const oldest = this.handledHintIds.values().next().value;
    if (oldest) this.handledHintIds.delete(oldest);
  }

  private async performSlotReconcile(slotId: string, reason: ReconcileReason): Promise<void> {
    const slot = this.dependencies.getSlots().find((item) => item.tokenSHA256 === slotId);
    if (!slot) {
      useProTradeIndexStore.getState().removeSlotSnapshots(slotId);
      return;
    }

    const epoch = this.epoch;
    const startedAt = this.dependencies.now();
    const previousSync = useProTradeIndexStore.getState().syncBySlot[slotId];
    useProTradeIndexStore.getState().setSlotSync({
      ...previousSync,
      slotId,
      epoch,
      inFlight: true,
      lastAttemptAt: startedAt,
      error: undefined
    });

    const coordinators = selectRefreshCoordinators(slot, this.dependencies.getCoordinators(), reason);
    if (coordinators.length === 0) {
      useProTradeIndexStore.getState().setSlotSync({
        slotId,
        epoch,
        inFlight: false,
        lastAttemptAt: startedAt,
        lastSuccessAt: previousSync?.lastSuccessAt,
        nextEligibleAt: startedAt + PRO_RECONCILE_POLICY.idleMinMs
      });
      return;
    }

    try {
      const result = await this.dependencies.refreshRobotSlot(slot.token, coordinators);
      if (epoch !== this.epoch) return;
      await mapWithConcurrency(result.coordinators, PRO_RECONCILE_POLICY.maxOrderRequests, async (robot) => {
        await this.reconcileCoordinator(slot, robot, reason, epoch);
      });
      if (epoch !== this.epoch) return;
      const completedAt = this.dependencies.now();
      const failures = result.coordinators.filter((robot) => Boolean(robot.error)).length;
      const successes = result.coordinators.length - failures;
      useProTradeIndexStore.getState().setSlotSync({
        slotId,
        epoch,
        inFlight: false,
        lastAttemptAt: startedAt,
        lastSuccessAt: successes > 0 ? completedAt : previousSync?.lastSuccessAt,
        nextEligibleAt: completedAt + (failures > 0
          ? jitteredDelay(PRO_RECONCILE_POLICY.waitingMinMs, PRO_RECONCILE_POLICY.waitingMaxMs)
          : nextDelayForSlot(slot)),
        error: failures === 0 ? undefined : successes > 0 ? "partial-failure" : "refresh-failed"
      });
    } catch {
      if (epoch !== this.epoch) return;
      useProTradeIndexStore.getState().setSlotSync({
        slotId,
        epoch,
        inFlight: false,
        lastAttemptAt: startedAt,
        lastSuccessAt: previousSync?.lastSuccessAt,
        nextEligibleAt: startedAt + PRO_RECONCILE_POLICY.waitingMinMs,
        error: "refresh-failed"
      });
    }
  }

  private async reconcileCoordinator(
    slot: RobotSlot,
    robot: RefreshRobotCoordinatorResult,
    reason: ReconcileReason,
    epoch: number
  ): Promise<void> {
    const coordinator = this.dependencies.getCoordinators().find((item) => item.shortAlias === robot.shortAlias);
    if (!coordinator?.url) return;
    const orderIds = uniqueOrderIds(robot);

    if (robot.error) {
      markCoordinatorSnapshotsFailed(slot.tokenSHA256, robot.shortAlias, "coordinator-unavailable");
      return;
    }

    useProTradeIndexStore.getState().removeCoordinatorSnapshots(slot.tokenSHA256, robot.shortAlias, orderIds);
    await Promise.all(orderIds.map((orderId) => this.refreshOrder(
      slot,
      coordinator,
      { slotId: slot.tokenSHA256, shortAlias: robot.shortAlias, orderId },
      robot,
      reason,
      epoch
    )));
  }

  private async refreshOrder(
    slot: RobotSlot,
    coordinator: CoordinatorSummary,
    locator: ProTradeLocator,
    robot: RefreshRobotCoordinatorResult | undefined,
    _reason: ReconcileReason,
    epoch: number
  ): Promise<void> {
    const key = proTradeKey(locator);
    const previous = useProTradeIndexStore.getState().snapshots[key];
    const actionGeneration = actionSequences.get(key) ?? 0;
    if (previous) {
      useProTradeIndexStore.getState().upsertSnapshot({ ...previous, freshness: "refreshing" });
    }

    try {
      const order = await this.orderLimiter.run(() => this.dependencies.fetchOrder(coordinator, locator.orderId, slot));
      if (epoch !== this.epoch || actionGeneration !== (actionSequences.get(key) ?? 0)) return;

      if (isReleasedPublicTake(order, robot)) {
        useGarageStore.getState().releaseOrderReservation(slot.token, locator.shortAlias, locator.orderId);
        useProTradeIndexStore.getState().removeTrade(locator);
        return;
      }

      const renewable = order.status === 5 && order.is_maker;
      if (isTerminalForDesk(order, renewable)) {
        useGarageStore.getState().syncOrderSnapshot({
          token: slot.token,
          shortAlias: locator.shortAlias,
          orderId: locator.orderId,
          status: order.status,
          isMaker: order.is_maker
        });
        useProTradeIndexStore.getState().removeTrade(locator);
        return;
      }

      useGarageStore.getState().syncOrderSnapshot({
        token: slot.token,
        shortAlias: locator.shortAlias,
        orderId: locator.orderId,
        status: order.status,
        isMaker: order.is_maker
      });
      const updatedAt = this.dependencies.now();
      const changed = !previous?.order || orderChanged(previous.order, order);
      const snapshot: ProTradeSnapshot = {
        key,
        locator,
        nickname: slot.nickname,
        hashId: slot.hashId,
        order: { ...order, shortAlias: locator.shortAlias },
        activeOrderId: robot?.activeOrderId,
        lastOrderId: robot?.lastOrderId,
        renewable,
        released: false,
        freshness: "fresh",
        updatedAt,
        changedAt: changed ? updatedAt : previous.changedAt
      };
      useProTradeIndexStore.getState().upsertSnapshot(snapshot);
      useProTradeIndexStore.getState().clearDirty(locator);
    } catch (error) {
      if (epoch !== this.epoch || actionGeneration !== (actionSequences.get(key) ?? 0)) return;
      if (isAlreadyCancelledError(error)) {
        useGarageStore.getState().syncOrderSnapshot({
          token: slot.token,
          shortAlias: locator.shortAlias,
          orderId: locator.orderId,
          status: 4,
          isMaker: previous?.order?.is_maker
        });
        useProTradeIndexStore.getState().removeTrade(locator);
        return;
      }
      if (previous) {
        useProTradeIndexStore.getState().upsertSnapshot({
          ...previous,
          freshness: "error",
          errorCode: "order-unavailable"
        });
      }
    }
  }

}

const actionSequences = new Map<string, number>();

export function markProOrderActionStarted(locator: ProTradeLocator): void {
  const key = proTradeKey(locator);
  actionSequences.set(key, (actionSequences.get(key) ?? 0) + 1);
}

export function markProOrderActionFinished(locator: ProTradeLocator): void {
  const key = proTradeKey(locator);
  actionSequences.set(key, (actionSequences.get(key) ?? 0) + 1);
}

export const garageReconciler = new GarageReconciler({
  now: Date.now,
  getSlots: () => useGarageStore.getState().slots,
  getCoordinators: () => useFederationStore.getState().coordinators,
  refreshRobotSlot: (token, coordinators) => useGarageStore.getState().refreshRobotSlot(token, coordinators),
  fetchOrder: async (coordinator, orderId, slot) => {
    const auth = getRobotAuthForCoordinator(slot, coordinator.shortAlias);
    if (!auth) throw new Error("robot-auth-unavailable");
    return {
      ...(await fetchOrder(coordinator.url, orderId, auth, { timeoutProfile: "background" })),
      shortAlias: coordinator.shortAlias
    };
  }
});

function selectRefreshCoordinators(
  slot: RobotSlot,
  coordinators: CoordinatorSummary[],
  reason: ReconcileReason
): CoordinatorSummary[] {
  const enabled = coordinators.filter((coordinator) => coordinator.enabled && coordinator.url && coordinator.shortAlias !== "local");
  if (reason === "manual") return enabled;
  const known = new Set(Object.keys(slot.robots).filter((alias) => alias !== "local"));
  return enabled.filter((coordinator) => known.has(coordinator.shortAlias));
}

function prioritizeSlots(slots: RobotSlot[]): RobotSlot[] {
  return [...slots].sort((left, right) => {
    const active = Number(Boolean(right.activeOrderId)) - Number(Boolean(left.activeOrderId));
    return active || left.nickname.localeCompare(right.nickname);
  });
}

function uniqueOrderIds(robot: RefreshRobotCoordinatorResult): number[] {
  return [...new Set([
    robot.activeOrderId,
    robot.renewableOrderId,
    robot.lastOrderId
  ].filter((value): value is number => Boolean(value && value !== robot.releasedOrderId)))];
}

function nextDelayForSlot(slot: RobotSlot): number {
  if (slot.activeOrderId) {
    return jitteredDelay(PRO_RECONCILE_POLICY.activeMinMs, PRO_RECONCILE_POLICY.activeMaxMs);
  }
  if (Object.values(slot.robots).some((robot) => robot.lastOrderId || robot.renewableOrderId)) {
    return jitteredDelay(PRO_RECONCILE_POLICY.waitingMinMs, PRO_RECONCILE_POLICY.waitingMaxMs);
  }
  return jitteredDelay(PRO_RECONCILE_POLICY.idleMinMs, PRO_RECONCILE_POLICY.idleMaxMs);
}

function markCoordinatorSnapshotsFailed(slotId: string, shortAlias: string, errorCode: string): void {
  const state = useProTradeIndexStore.getState();
  for (const snapshot of Object.values(state.snapshots)) {
    if (snapshot.locator.slotId !== slotId || snapshot.locator.shortAlias !== shortAlias) continue;
    state.upsertSnapshot({ ...snapshot, freshness: "error", errorCode });
  }
}

function isReleasedPublicTake(order: OrderDto, robot?: RefreshRobotCoordinatorResult): boolean {
  return order.status === 1 && !order.is_maker && robot?.activeOrderId === order.id;
}

function isTerminalForDesk(order: OrderDto, renewable: boolean): boolean {
  return !renewable && isTerminalForProDesk(order.status, order.is_maker);
}

export function isTerminalForProDesk(status: number, isMaker: boolean): boolean {
  return [4, 12, 14, 17, 18].includes(status) || (status === 5 && !isMaker);
}

function orderChanged(previous: OrderDto, current: OrderDto): boolean {
  return previous.status !== current.status
    || previous.expires_at !== current.expires_at
    || previous.amount !== current.amount
    || previous.min_amount !== current.min_amount
    || previous.max_amount !== current.max_amount
    || previous.payment_method !== current.payment_method;
}

function isRecentHint(hint: OrderHint, now: number): boolean {
  const createdAt = hint.createdAt < 1_000_000_000_000 ? hint.createdAt * 1000 : hint.createdAt;
  return createdAt <= now + 10 * 60_000 && createdAt >= now - 7 * 24 * 60 * 60_000;
}
