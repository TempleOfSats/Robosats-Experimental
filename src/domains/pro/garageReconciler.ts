import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import {
  getRobotAuthForCoordinator,
  type RefreshRobotCoordinatorResult,
  type RefreshRobotSlotOptions,
  type RefreshRobotSlotResult,
  type RobotSlot,
  useGarageStore
} from "@/domains/garage/garageStore";
import { fetchOrder } from "@/domains/orders/orderApi";
import { ingestCoordinatorOrder } from "@/domains/orders/orderActivity";
import type {
  NativeOrderChangeNotification,
  NostrOrderChangeNotification
} from "@/domains/orders/orderChangeNotifications";
import { isTradeVisible } from "@/domains/notifications/orderFeedbackVisibility";
import { isAlreadyCancelledError } from "@/domains/orders/orderStore";
import type { OrderDto } from "@/domains/orders/order.types";
import { CoordinatorRequestBackoff } from "@/domains/pro/coordinatorRequestBackoff";
import { applyProOrderSnapshot } from "@/domains/pro/proOrderActivity";
import { deriveProRobotLifecycle } from "@/domains/pro/proRobotLifecycle";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import { selectProGarageSlots, useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { classifyProTrade } from "@/domains/pro/proSelectors";
import {
  type ProTradeLocator,
  type ProTradeSnapshot,
  type ReconcileReason,
  type SlotSyncState,
  proTradeKey
} from "@/domains/pro/pro.types";
import { canBypassCadence, jitteredDelay, mapWithConcurrency, PRO_RECONCILE_POLICY } from "@/domains/pro/reconcilePolicy";

type GarageReconcilerDependencies = {
  now: () => number;
  getSlots: () => RobotSlot[];
  getCoordinators: () => CoordinatorSummary[];
  refreshRobotSlot: (
    token: string,
    coordinators: CoordinatorSummary[],
    options?: RefreshRobotSlotOptions
  ) => Promise<RefreshRobotSlotResult>;
  fetchOrder: (
    coordinator: CoordinatorSummary,
    orderId: number,
    slot: RobotSlot,
    reason: ReconcileReason
  ) => Promise<OrderDto>;
};

export interface GarageReconcileController {
  reconcileAll(reason: ReconcileReason): Promise<void>;
  reconcileSlot(slotId: string, reason: ReconcileReason): Promise<void>;
  reconcileOrder(locator: ProTradeLocator, reason: ReconcileReason): Promise<void>;
  handleOrderHint(hint: NostrOrderChangeNotification): Promise<boolean>;
  handleNativeOrderHint(hint: NativeOrderChangeNotification): Promise<boolean>;
  resetAfterTransportReconnect(): void;
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
  private readonly inFlightOrderReads = new Map<string, Promise<OrderDto>>();
  private readonly orderLimiter = new AsyncLimiter(PRO_RECONCILE_POLICY.maxOrderRequests);
  private readonly handledHintIds = new Set<string>();
  private readonly lastDiscoveryBySlot = new Map<string, number>();
  private readonly coordinatorBackoff = new CoordinatorRequestBackoff();

  constructor(private readonly dependencies: GarageReconcilerDependencies) {}

  async reconcileAll(reason: ReconcileReason): Promise<void> {
    const tradeIndex = useProTradeIndexStore.getState();
    const slots = prioritizeSlots(this.dependencies.getSlots(), tradeIndex.snapshots, tradeIndex.dirtyKeys);
    await mapWithConcurrency(slots, PRO_RECONCILE_POLICY.maxRobotRequests, (slot) =>
      this.reconcileSlot(slot.tokenSHA256, reason)
    );
  }

  async reconcileSlot(slotId: string, reason: ReconcileReason): Promise<void> {
    const existing = this.inFlightSlots.get(slotId);
    if (existing) return existing;

    const sync = useProTradeIndexStore.getState().syncBySlot[slotId];
    const now = this.dependencies.now();
    if (this.canKeepLocalReady(slotId, sync, reason, now)) return;
    if (shouldSuppressAutomaticBurst(sync, reason, now)) return;
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

  async handleOrderHint(hint: NostrOrderChangeNotification): Promise<boolean> {
    const slot = this.dependencies.getSlots().find((item) => item.nostrPubKey === hint.recipientPubkey);
    const coordinator = this.dependencies.getCoordinators().find((item) =>
      item.enabled && item.nostrHexPubkey?.toLowerCase() === hint.coordinatorPubkey.toLowerCase()
    );
    if (!slot || !coordinator) return false;
    if (
      this.handledHintIds.has(hint.eventId)
      || !isRecentHint(hint, this.dependencies.now())
      || hint.shortAlias !== coordinator.shortAlias
    ) return true;
    this.rememberHint(hint.eventId);
    const normalizedHint = { ...hint, shortAlias: coordinator.shortAlias };
    useProTradeIndexStore.getState().markDirtyByNostr(slot.tokenSHA256, normalizedHint);
    if (hint.orderId) {
      await this.reconcileOrder({ slotId: slot.tokenSHA256, shortAlias: coordinator.shortAlias, orderId: hint.orderId }, "nostr-hint");
      return true;
    }
    await this.reconcileSlot(slot.tokenSHA256, "nostr-hint");
    return true;
  }

  async handleNativeOrderHint(hint: NativeOrderChangeNotification): Promise<boolean> {
    const { orderId, shortAlias: hintedAlias } = hint;
    if (!orderId) {
      if (
        this.dependencies.getSlots().length === 0
        || this.dependencies.getCoordinators().length === 0
      ) return false;
      await this.reconcileAll("nostr-hint");
      return true;
    }
    const locators = new Map<string, ProTradeLocator>();
    for (const slot of this.dependencies.getSlots()) {
      for (const [shortAlias, robot] of Object.entries(slot.robots)) {
        if (hintedAlias && hintedAlias !== shortAlias) continue;
        if (![robot.activeOrderId, robot.lastOrderId, robot.renewableOrderId].includes(orderId)) continue;
        const locator = { slotId: slot.tokenSHA256, shortAlias, orderId };
        locators.set(proTradeKey(locator), locator);
      }
    }
    for (const snapshot of Object.values(useProTradeIndexStore.getState().snapshots)) {
      if (
        snapshot.locator.orderId === orderId
        && (!hintedAlias || snapshot.locator.shortAlias === hintedAlias)
      ) {
        locators.set(snapshot.key, snapshot.locator);
      }
    }
    if (locators.size === 0) return true;
    const coordinators = this.dependencies.getCoordinators();
    if ([...locators.values()].some((locator) => !coordinators.some((coordinator) =>
      coordinator.enabled && coordinator.url && coordinator.shortAlias === locator.shortAlias
    ))) return false;
    await Promise.all([...locators.values()].map((locator) =>
      this.reconcileOrder(locator, "nostr-hint")
    ));
    return true;
  }

  resetAfterTransportReconnect(): void {
    this.epoch += 1;
    this.inFlightSlots.clear();
    this.coordinatorBackoff.reset();
  }

  private canKeepLocalReady(
    slotId: string,
    sync: SlotSyncState | undefined,
    reason: ReconcileReason,
    now: number
  ): boolean {
    if (!sync?.locallyReadyAt || !sync.nextEligibleAt || sync.nextEligibleAt <= now) return false;
    if (reason === "manual" || reason === "nostr-hint") return false;
    const slot = this.dependencies.getSlots().find((item) => item.tokenSHA256 === slotId);
    if (!slot) return false;
    const tradeIndex = useProTradeIndexStore.getState();
    return deriveProRobotLifecycle(
      slot,
      tradeIndex.snapshots,
      sync,
      { ignorePending: true }
    ).canStartOrder;
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

    const selection = selectRefreshCoordinators(
      slot,
      this.dependencies.getCoordinators(),
      reason,
      startedAt,
      this.lastDiscoveryBySlot.get(slotId)
    );
    const bypassBackoff = canBypassCoordinatorBackoff(reason);
    const coordinators = selection.coordinators.filter((coordinator) =>
      this.coordinatorBackoff.tryAcquire(coordinator.url, startedAt, bypassBackoff)
    );
    if (selection.discovery) this.lastDiscoveryBySlot.set(slotId, startedAt);
    if (coordinators.length === 0) {
      const nextCoordinatorAttempt = earliestCoordinatorRetry(
        selection.coordinators,
        this.coordinatorBackoff
      );
      useProTradeIndexStore.getState().setSlotSync({
        ...previousSync,
        slotId,
        epoch,
        inFlight: false,
        attemptedCoordinators: 0,
        lastAttemptAt: startedAt,
        lastSuccessAt: previousSync?.lastSuccessAt,
        nextEligibleAt: nextCoordinatorAttempt
          ? Math.min(nextCoordinatorAttempt, startedAt + PRO_RECONCILE_POLICY.idleMinMs)
          : startedAt + PRO_RECONCILE_POLICY.idleMinMs
      });
      return;
    }

    try {
      const directlyRefreshed = new Set<string>();
      const directOrderRefresh = this.reconcileKnownOrders(
        slot,
        coordinators,
        reason,
        epoch,
        directlyRefreshed
      );
      const immediateCoordinatorTasks: Promise<void>[] = [];
      const observedAliases = new Set<string>();
      const interactive = isInteractiveOrderRead(reason);
      const result = await this.dependencies.refreshRobotSlot(slot.token, coordinators, {
        priority: interactive ? "foreground" : "background",
        source: "fleet-reconcile",
        preferredAliases: preferredCoordinatorAliases(slot),
        maxAgeMs: reason === "interval" ? PRO_RECONCILE_POLICY.statusFreshMs : undefined,
        onCoordinatorResult: (robot) => {
          if (observedAliases.has(robot.shortAlias)) return;
          observedAliases.add(robot.shortAlias);
          this.recordCoordinatorResult(coordinators, robot);
          immediateCoordinatorTasks.push(
            this.reconcileCoordinator(slot, robot, reason, epoch, directlyRefreshed)
          );
        }
      });
      if (epoch !== this.epoch) return;
      await Promise.all([
        directOrderRefresh,
        ...immediateCoordinatorTasks,
        mapWithConcurrency(
          result.coordinators.filter((robot) => !observedAliases.has(robot.shortAlias)),
          PRO_RECONCILE_POLICY.maxOrderRequests,
          async (robot) => {
            observedAliases.add(robot.shortAlias);
            this.recordCoordinatorResult(coordinators, robot);
            await this.reconcileCoordinator(slot, robot, reason, epoch, directlyRefreshed);
          }
        )
      ]);
      if (epoch !== this.epoch) return;
      const completedAt = this.dependencies.now();
      const attempted = result.coordinators.filter((robot) => !robot.cached);
      const failures = attempted.filter((robot) => Boolean(robot.error)).length;
      const successes = attempted.length - failures;
      useProTradeIndexStore.getState().setSlotSync({
        slotId,
        epoch,
        inFlight: false,
        attemptedCoordinators: attempted.length,
        lastAttemptAt: startedAt,
        lastSuccessAt: successes > 0 ? completedAt : previousSync?.lastSuccessAt,
        nextEligibleAt: completedAt + (failures > 0
          ? jitteredDelay(PRO_RECONCILE_POLICY.waitingMinMs, PRO_RECONCILE_POLICY.waitingMaxMs)
          : nextDelayForSlot(slot, useProTradeIndexStore.getState().snapshots)),
        error: failures === 0 ? undefined : successes > 0 ? "partial-failure" : "refresh-failed"
      });
    } catch {
      if (epoch !== this.epoch) return;
      useProTradeIndexStore.getState().setSlotSync({
        slotId,
        epoch,
        inFlight: false,
        attemptedCoordinators: coordinators.length,
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
    epoch: number,
    alreadyRefreshed = new Set<string>()
  ): Promise<void> {
    const coordinator = this.dependencies.getCoordinators().find((item) => item.shortAlias === robot.shortAlias);
    if (!coordinator?.url) return;
    const orderIds = unarchivedOrderIds(slot, robot);

    if (robot.error) {
      markCoordinatorSnapshotsFailed(slot.tokenSHA256, robot.shortAlias, "coordinator-unavailable");
      return;
    }

    useProTradeIndexStore.getState().removeCoordinatorSnapshots(slot.tokenSHA256, robot.shortAlias, orderIds);
    await Promise.all(orderIds
      .filter((orderId) => !alreadyRefreshed.has(proTradeKey({
        slotId: slot.tokenSHA256,
        shortAlias: robot.shortAlias,
        orderId
      })))
      .map((orderId) => this.refreshOrder(
      slot,
      coordinator,
      { slotId: slot.tokenSHA256, shortAlias: robot.shortAlias, orderId },
      robot,
      reason,
      epoch
    )));
  }

  private async reconcileKnownOrders(
    slot: RobotSlot,
    coordinators: CoordinatorSummary[],
    reason: ReconcileReason,
    epoch: number,
    refreshedKeys: Set<string>
  ): Promise<void> {
    const coordinatorsByAlias = new Map(coordinators.map((coordinator) => [
      coordinator.shortAlias,
      coordinator
    ]));
    const snapshots = Object.values(useProTradeIndexStore.getState().snapshots)
      .filter((snapshot) => snapshot.locator.slotId === slot.tokenSHA256)
      .filter((snapshot) => coordinatorsByAlias.has(snapshot.locator.shortAlias));

    await mapWithConcurrency(snapshots, PRO_RECONCILE_POLICY.maxOrderRequests, async (snapshot) => {
      const coordinator = coordinatorsByAlias.get(snapshot.locator.shortAlias);
      if (!coordinator) return;
      refreshedKeys.add(snapshot.key);
      await this.refreshOrder(slot, coordinator, snapshot.locator, undefined, reason, epoch);
    });
  }

  private recordCoordinatorResult(
    coordinators: CoordinatorSummary[],
    robot: RefreshRobotCoordinatorResult
  ): void {
    if (robot.cached) return;
    const coordinator = coordinators.find((item) => item.shortAlias === robot.shortAlias);
    if (!coordinator?.url) return;
    if (robot.transportFailed ?? Boolean(robot.error)) {
      this.coordinatorBackoff.recordFailure(coordinator.url, this.dependencies.now());
      return;
    }
    this.coordinatorBackoff.recordSuccess(coordinator.url);
  }

  private async refreshOrder(
    slot: RobotSlot,
    coordinator: CoordinatorSummary,
    locator: ProTradeLocator,
    robot: RefreshRobotCoordinatorResult | undefined,
    reason: ReconcileReason,
    epoch: number
  ): Promise<void> {
    if (visibleOrderPageOwnsHintRefresh(reason, locator, slot)) return;
    const key = proTradeKey(locator);
    let previous = useProTradeIndexStore.getState().snapshots[key];
    const pendingSnapshot = previous ? undefined : pendingOrderSnapshot(slot, locator, robot, this.dependencies.now());
    if (pendingSnapshot) {
      useProTradeIndexStore.getState().upsertSnapshot(pendingSnapshot);
      previous = pendingSnapshot;
    }
    const actionGeneration = beginTrackedOrderRefresh(key);

    try {
      const order = await this.readOrder(slot, coordinator, locator, reason, epoch, actionGeneration);
      if (epoch !== this.epoch || actionGeneration !== (actionSequences.get(key) ?? 0)) {
        removePendingOrderSnapshot(pendingSnapshot);
        return;
      }

      const observedOrder = ingestCoordinatorOrder({
        order: { ...order, shortAlias: locator.shortAlias },
        shortAlias: locator.shortAlias,
        slot
      });
      applyProOrderSnapshot({
        activeOrderId: robot?.activeOrderId,
        authoritative: true,
        lastOrderId: robot?.lastOrderId,
        observedAt: this.dependencies.now(),
        order: observedOrder,
        releasePublicTake: isReleasedPublicTake(order, robot),
        shortAlias: locator.shortAlias,
        slot
      });
    } catch (error) {
      if (epoch !== this.epoch || actionGeneration !== (actionSequences.get(key) ?? 0)) {
        removePendingOrderSnapshot(pendingSnapshot);
        return;
      }
      if (isAlreadyCancelledError(error)) {
        if (previous?.order) {
          ingestCoordinatorOrder({
            order: {
              ...previous.order,
              id: locator.orderId,
              shortAlias: locator.shortAlias,
              status: 4,
              status_message: "Order cancelled"
            },
            shortAlias: locator.shortAlias,
            slot
          });
        }
        useGarageStore.getState().releaseOrderReservation(
          slot.token,
          locator.shortAlias,
          locator.orderId
        );
        useProTradeIndexStore.getState().removeTrade(locator);
        return;
      }
      if (previous) {
        const current = useProTradeIndexStore.getState().snapshots[key] ?? previous;
        useProTradeIndexStore.getState().upsertSnapshot({
          ...current,
          freshness: current.order ? current.freshness : "error",
          errorCode: current.errorCode === "coordinator-unavailable"
            ? current.errorCode
            : "order-unavailable"
        });
      }
    } finally {
      finishTrackedOrderRefresh(key);
    }
  }

  private readOrder(
    slot: RobotSlot,
    coordinator: CoordinatorSummary,
    locator: ProTradeLocator,
    reason: ReconcileReason,
    epoch: number,
    actionGeneration: number
  ): Promise<OrderDto> {
    const key = `${proTradeKey(locator)}:${epoch}:${actionGeneration}`;
    const existing = this.inFlightOrderReads.get(key);
    if (existing) return existing;
    const request = this.orderLimiter
      .run(() => this.dependencies.fetchOrder(coordinator, locator.orderId, slot, reason))
      .finally(() => {
        if (this.inFlightOrderReads.get(key) === request) this.inFlightOrderReads.delete(key);
      });
    this.inFlightOrderReads.set(key, request);
    return request;
  }

}

function pendingOrderSnapshot(
  slot: RobotSlot,
  locator: ProTradeLocator,
  robot: RefreshRobotCoordinatorResult | undefined,
  observedAt: number
): ProTradeSnapshot {
  return {
    key: proTradeKey(locator),
    locator,
    nickname: slot.nickname,
    hashId: slot.hashId,
    activeOrderId: robot?.activeOrderId,
    lastOrderId: robot?.lastOrderId ?? locator.orderId,
    renewable: robot?.renewableOrderId === locator.orderId,
    released: false,
    freshness: "refreshing",
    updatedAt: observedAt
  };
}

function removePendingOrderSnapshot(snapshot: ProTradeSnapshot | undefined): void {
  if (!snapshot) return;
  if (useProTradeIndexStore.getState().snapshots[snapshot.key] !== snapshot) return;
  useProTradeIndexStore.getState().removeTrade(snapshot.locator);
}

const actionSequences = new Map<string, number>();
const activeOrderRefreshes = new Map<string, number>();

export function markProOrderActionStarted(locator: ProTradeLocator): void {
  advanceActionSequence(proTradeKey(locator));
}

export function markProOrderActionFinished(locator: ProTradeLocator): void {
  advanceActionSequence(proTradeKey(locator));
}

function beginTrackedOrderRefresh(key: string): number {
  activeOrderRefreshes.set(key, (activeOrderRefreshes.get(key) ?? 0) + 1);
  return actionSequences.get(key) ?? 0;
}

function finishTrackedOrderRefresh(key: string): void {
  const remaining = (activeOrderRefreshes.get(key) ?? 1) - 1;
  if (remaining > 0) {
    activeOrderRefreshes.set(key, remaining);
    return;
  }
  activeOrderRefreshes.delete(key);
  actionSequences.delete(key);
}

function advanceActionSequence(key: string): void {
  if (!activeOrderRefreshes.has(key)) {
    actionSequences.delete(key);
    return;
  }
  actionSequences.set(key, (actionSequences.get(key) ?? 0) + 1);
}

export const garageReconciler = new GarageReconciler({
  now: Date.now,
  getSlots: () => selectProGarageSlots(
    useGarageStore.getState().slots,
    useGarageVaultStore.getState().manifest
  ),
  getCoordinators: () => useFederationStore.getState().coordinators,
  refreshRobotSlot: (token, coordinators, options) =>
    useGarageStore.getState().refreshRobotSlot(token, coordinators, options),
  fetchOrder: async (coordinator, orderId, slot, reason) => {
    const auth = getRobotAuthForCoordinator(slot, coordinator.shortAlias);
    if (!auth) throw new Error("robot-auth-unavailable");
    const foreground = isInteractiveOrderRead(reason);
    return {
      ...(await fetchOrder(coordinator.url, orderId, auth, {
        timeoutProfile: foreground ? "interactive" : "background",
        priority: foreground ? "foreground" : "background",
        source: "fleet-reconcile"
      })),
      shortAlias: coordinator.shortAlias
    };
  }
});

function preferredCoordinatorAliases(slot: RobotSlot): string[] {
  return Object.entries(slot.robots)
    .sort(([, left], [, right]) => {
      const leftRank = left.activeOrderId ? 0 : left.renewableOrderId || left.lastOrderId ? 1 : 2;
      const rightRank = right.activeOrderId ? 0 : right.renewableOrderId || right.lastOrderId ? 1 : 2;
      return leftRank - rightRank;
    })
    .map(([alias]) => alias)
    .filter((alias) => alias !== "local");
}

function selectRefreshCoordinators(
  slot: RobotSlot,
  coordinators: CoordinatorSummary[],
  reason: ReconcileReason,
  now: number,
  lastDiscoveryAt?: number
): { coordinators: CoordinatorSummary[]; discovery: boolean } {
  const enabled = coordinators.filter((coordinator) => coordinator.enabled && coordinator.url && coordinator.shortAlias !== "local");
  if (reason === "manual") return { coordinators: enabled, discovery: true };
  const known = new Set(Object.keys(slot.robots).filter((alias) => alias !== "local"));
  const discoveryDue = reason === "interval"
    && (!lastDiscoveryAt || now - lastDiscoveryAt >= PRO_RECONCILE_POLICY.fullDiscoveryMinMs);
  if (((reason === "startup" || reason === "fleet-ready") && known.size === 0) || discoveryDue) {
    return { coordinators: enabled, discovery: true };
  }
  return {
    coordinators: enabled.filter((coordinator) => known.has(coordinator.shortAlias)),
    discovery: false
  };
}

function prioritizeSlots(
  slots: RobotSlot[],
  snapshots: Record<string, ProTradeSnapshot>,
  dirtyKeys: Partial<Record<string, true>>
): RobotSlot[] {
  const bySlot = new Map<string, ProTradeSnapshot[]>();
  for (const snapshot of Object.values(snapshots)) {
    const entries = bySlot.get(snapshot.locator.slotId) ?? [];
    entries.push(snapshot);
    bySlot.set(snapshot.locator.slotId, entries);
  }
  return [...slots].sort((left, right) => {
    const priority = slotPriority(left, bySlot.get(left.tokenSHA256) ?? [], dirtyKeys)
      - slotPriority(right, bySlot.get(right.tokenSHA256) ?? [], dirtyKeys);
    return priority || left.nickname.localeCompare(right.nickname);
  });
}

function slotPriority(
  slot: RobotSlot,
  snapshots: ProTradeSnapshot[],
  dirtyKeys: Partial<Record<string, true>>
): number {
  if (snapshots.some((snapshot) => dirtyKeys[snapshot.key])) return 0;
  if (snapshots.some((snapshot) => classifyProTrade(snapshot) === "needs-action")) return 1;
  if (slot.activeOrderId) return 2;
  if (snapshots.some((snapshot) => snapshot.renewable)) return 3;
  if (snapshots.some((snapshot) => snapshot.order?.status === 1)) return 4;
  if (snapshots.length > 0) return 5;
  return 6;
}

function unarchivedOrderIds(slot: RobotSlot, robot: RefreshRobotCoordinatorResult): number[] {
  const local = slot.robots[robot.shortAlias];
  const releasedOrderIds = new Set([
    robot.releasedOrderId,
    local?.releasedOrderId
  ].filter((value): value is number => Boolean(value)));
  const orderIds = [...new Set([
    robot.activeOrderId,
    robot.renewableOrderId,
    robot.lastOrderId,
    local?.activeOrderId,
    local?.renewableOrderId,
    local?.lastOrderId
  ].filter((value): value is number => Boolean(value && !releasedOrderIds.has(value))))];
  const history = useGarageVaultStore.getState().history?.entries ?? [];
  return orderIds.filter((orderId) => !history.some((entry) =>
    entry.slotId === slot.tokenSHA256
      && entry.coordinatorShortAlias === robot.shortAlias
      && entry.orderId === orderId
  ));
}

function nextDelayForSlot(slot: RobotSlot, snapshots: Record<string, ProTradeSnapshot>): number {
  const slotSnapshots = Object.values(snapshots).filter((snapshot) =>
    snapshot.locator.slotId === slot.tokenSHA256 && !snapshot.released
  );
  if (slotSnapshots.some((snapshot) =>
    snapshot.order && ![1, 2, 5].includes(snapshot.order.status)
  )) {
    return jitteredDelay(PRO_RECONCILE_POLICY.activeMinMs, PRO_RECONCILE_POLICY.activeMaxMs);
  }
  if (slotSnapshots.some((snapshot) =>
    snapshot.renewable || snapshot.order?.status === 1 || snapshot.order?.status === 2
  )) {
    return jitteredDelay(PRO_RECONCILE_POLICY.waitingMinMs, PRO_RECONCILE_POLICY.waitingMaxMs);
  }
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
    state.upsertSnapshot({ ...snapshot, errorCode });
  }
}

function isReleasedPublicTake(order: OrderDto, robot?: RefreshRobotCoordinatorResult): boolean {
  return order.status === 1 && !order.is_maker && robot?.activeOrderId === order.id;
}

function visibleOrderPageOwnsHintRefresh(
  reason: ReconcileReason,
  locator: ProTradeLocator,
  slot: RobotSlot
): boolean {
  return reason === "nostr-hint"
    && isTradeVisible(locator.shortAlias, locator.orderId, slot.tokenSHA256);
}

function isRecentHint(hint: NostrOrderChangeNotification, now: number): boolean {
  const createdAt = hint.createdAt < 1_000_000_000_000 ? hint.createdAt * 1000 : hint.createdAt;
  return createdAt <= now + 10 * 60_000 && createdAt >= now - 7 * 24 * 60 * 60_000;
}

function canBypassCoordinatorBackoff(reason: ReconcileReason): boolean {
  return reason === "manual"
    || reason === "order-action"
    || reason === "nostr-hint";
}

function isInteractiveOrderRead(reason: ReconcileReason): boolean {
  return reason === "startup"
    || reason === "fleet-ready"
    || reason === "manual"
    || reason === "order-action"
    || reason === "nostr-hint";
}

function earliestCoordinatorRetry(
  coordinators: CoordinatorSummary[],
  backoff: CoordinatorRequestBackoff
): number | undefined {
  const attempts = coordinators
    .map((coordinator) => backoff.nextAttemptAt(coordinator.url))
    .filter((value): value is number => value !== undefined);
  return attempts.length > 0 ? Math.min(...attempts) : undefined;
}

function shouldSuppressAutomaticBurst(
  sync: SlotSyncState | undefined,
  reason: ReconcileReason,
  now: number
): boolean {
  if (!sync?.lastAttemptAt || sync.error) return false;
  // A slot skipped by coordinator backoff has not made a network attempt. Let
  // the confirmed Tor reconnect include it in the bounded recovery wave.
  if (
    reason === "tor-reconnected"
    && (sync.inFlight || sync.attemptedCoordinators === 0)
  ) return false;
  if (![
    "startup",
    "fleet-ready",
    "online",
    "tor-ready",
    "tor-reconnected",
    "window-focus",
    "visibility-resume"
  ].includes(reason)) return false;
  return now - sync.lastAttemptAt < PRO_RECONCILE_POLICY.automaticBurstGuardMs;
}
