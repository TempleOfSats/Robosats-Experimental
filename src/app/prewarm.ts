import {
  preloadAllAppRoutes,
  preloadPrimaryTradeRoutes,
  preloadQuickAccessRoutes
} from "@/app/routes";
import {
  isStandardGarageRoute,
  ROUTE_TRANSITION_READY_EVENT
} from "@/domains/navigation/routeTransition";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import {
  getRobotAuthForCoordinator,
  selectCurrentSlot,
  selectStandardGarageSlots,
  type RefreshRobotSlotResult,
  type RobotSlot,
  useGarageStore
} from "@/domains/garage/garageStore";
import { subscribeRobotDataRefresh } from "@/domains/garage/robotDataRefresh";
import { startOrderChangeHintRuntime } from "@/domains/nostr/orderChangeHints";
import { ingestCoordinatorOrder } from "@/domains/orders/orderActivity";
import { fetchOrder } from "@/domains/orders/orderApi";
import {
  orderChangeMatches,
  subscribeOrderChangeNotifications,
  type OrderChangeNotification
} from "@/domains/orders/orderChangeNotifications";
import { useOrderbookStore } from "@/domains/orderbook/orderbookStore";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import { getNativeTorDiagnostics, isNativeApp } from "@/domains/transport/androidBridge";
import { subscribeRefreshIntents, type RefreshReason } from "@/domains/transport/refreshIntents";
import {
  desktopBackgroundNotificationsEnabled,
  isTauriDesktop
} from "@/domains/transport/tauriBridge";

type IdleWindow = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

type StandardRobotRefreshScope = {
  orderIdsByAlias?: Map<string, Set<number>>;
};

type CoordinatorHealthRecoveryTarget = "all" | string[];

const FEDERATION_RECOVERY_START_DELAY_MS = 1_000;
const FEDERATION_RECOVERY_RETRY_DELAYS_MS = [15_000, 45_000] as const;

export function scheduleAppPrewarm(): () => void {
  const stopOrderChangeHints = startOrderChangeHintRuntime();
  let foregroundRefresh: Promise<void> | undefined;
  let stopFederationRecovery: () => void = () => undefined;
  let pendingNotificationScope: StandardRobotRefreshScope | undefined;
  const refreshForegroundRobot = (scope?: StandardRobotRefreshScope) => {
    if (foregroundRefresh) {
      if (scope) pendingNotificationScope = mergeStandardRefreshScopes(pendingNotificationScope, scope);
      return;
    }
    foregroundRefresh = refreshSelectedStandardRobotStatus(scope)
      .catch(() => undefined)
      .finally(() => {
        foregroundRefresh = undefined;
        const pending = pendingNotificationScope;
        pendingNotificationScope = undefined;
        if (pending) refreshForegroundRobot(pending);
      });
  };
  const refreshAfterLifecycle = (reason: RefreshReason) => {
    if (reason === "tor-ready" || reason === "tor-reconnected") {
      stopFederationRecovery();
      const federation = useFederationStore.getState();
      const enabled = federation.coordinators.filter((coordinator) => coordinator.enabled);
      const failedAliases = enabled
        .filter(coordinatorNeedsHealthRecovery)
        .map((coordinator) => coordinator.shortAlias);
      if (reason === "tor-reconnected" || failedAliases.length > 0) {
        stopFederationRecovery = scheduleCoordinatorHealthRecovery(
          reason === "tor-reconnected" ? "all" : failedAliases
        );
      }
    }
    if (reason === "tor-ready") {
      prewarmData();
      if (isStandardGarageRoute(window.location.pathname)) refreshForegroundRobot();
      return;
    }
    if (foregroundRefresh || (visibleTradeRoute() && document.visibilityState === "visible")) return;
    refreshForegroundRobot();
  };
  const stopLifecycle = subscribeRefreshIntents(refreshAfterLifecycle);
  const stopOrderChanges = subscribeOrderChangeNotifications((notification) => {
    if (useProPreferencesStore.getState().enabled) return true;
    useGarageStore.getState().hydrate();
    const scope = standardRobotRefreshScope(notification);
    if (!scope) return true;
    if (
      document.visibilityState === "visible"
      && visibleTradeMatchesOrderChange(notification)
    ) return true;
    refreshForegroundRobot(scope);
    return true;
  }, { consumerId: "standard-prewarm" });
  const stopRobotDataRefresh = subscribeRobotDataRefresh(prewarmData);
  const refreshGarageRoute = (event: Event) => {
    const path = (event as CustomEvent<{ path?: string }>).detail?.path ?? window.location.pathname;
    if (isStandardGarageRoute(path)) refreshForegroundRobot();
  };
  window.addEventListener(ROUTE_TRANSITION_READY_EVENT, refreshGarageRoute);
  if (isStandardGarageRoute(window.location.pathname)) refreshForegroundRobot();

  const cleanups = [
    scheduleIdle(prewarmData, 500, 3000),
    // These local route chunks do not use coordinator circuits. Warm them as
    // soon as the shell is idle so a slow/offline coordinator cannot make the
    // first Offers or Settings navigation wait on an app-onion round trip.
    scheduleIdle(preloadQuickAccessRoutes, 900, 7000),
    scheduleIdle(prewarmVisualAssets, 7000, 16000),
    scheduleDesktopNotificationRefresh()
  ];
  // Native and desktop packages read chunks locally, so warming the remaining
  // routes cannot consume Tor bandwidth.
  if (isNativeApp() || isTauriDesktop()) {
    cleanups.push(
      scheduleIdle(preloadPrimaryTradeRoutes, 1800, 6000),
      scheduleIdle(preloadAllAppRoutes, 4500, 12000)
    );
  }

  return () => {
    stopOrderChangeHints();
    stopLifecycle();
    stopOrderChanges();
    stopRobotDataRefresh();
    stopFederationRecovery();
    window.removeEventListener(ROUTE_TRANSITION_READY_EVENT, refreshGarageRoute);
    cleanups.forEach((cleanup) => cleanup());
  };
}

function scheduleCoordinatorHealthRecovery(initialTarget: CoordinatorHealthRecoveryTarget): () => void {
  let cancelled = false;
  let timer: number | undefined;

  const failedAliases = () =>
    useFederationStore
      .getState()
      .coordinators.filter((coordinator) => coordinator.enabled && coordinatorNeedsHealthRecovery(coordinator))
      .map((coordinator) => coordinator.shortAlias);

  const refreshCoordinatorAliases = async (aliases: string[]) => {
    if (cancelled || aliases.length === 0) return;
    const federation = useFederationStore.getState();
    const eligibleAliases = aliases.filter((shortAlias) => {
      const coordinator = federation.coordinators.find((item) => item.shortAlias === shortAlias);
      return Boolean(
        coordinator?.enabled
        && coordinator.url
        && (coordinator.loading || coordinatorNeedsHealthRecovery(coordinator))
      );
    });
    await Promise.allSettled(
      eligibleAliases.map((shortAlias) =>
        federation.refreshCoordinator(shortAlias, {
          force: true,
          priority: "background"
        })
      )
    );
  };

  const scheduleRetry = (retryIndex: number) => {
    if (cancelled || retryIndex >= FEDERATION_RECOVERY_RETRY_DELAYS_MS.length || failedAliases().length === 0) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      void retryFailedCoordinators(retryIndex);
    }, FEDERATION_RECOVERY_RETRY_DELAYS_MS[retryIndex]);
  };

  const retryFailedCoordinators = async (retryIndex: number) => {
    await refreshCoordinatorAliases(failedAliases());
    scheduleRetry(retryIndex + 1);
  };

  timer = window.setTimeout(() => {
    timer = undefined;
    const initialRefresh =
      initialTarget === "all"
        ? useFederationStore.getState().refreshCoordinators({
            force: true,
            priority: "background"
          })
        : refreshCoordinatorAliases(initialTarget);
    void initialRefresh.catch(() => undefined).then(() => scheduleRetry(0));
  }, FEDERATION_RECOVERY_START_DELAY_MS);

  return () => {
    cancelled = true;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

export function coordinatorNeedsHealthRecovery(coordinator: CoordinatorSummary): boolean {
  return Boolean(coordinator.url) && (coordinator.loading || !coordinator.online || Boolean(coordinator.error));
}

function prewarmData(): void {
  // Native WebSockets wait for Arti, but the Nostr session timeout is owned by
  // JavaScript. Do not start that clock until the SOCKS proxy is usable.
  if (isNativeApp() && !getNativeTorDiagnostics()?.connected) return;

  const garage = useGarageStore.getState();
  garage.hydrate();

  const federation = useFederationStore.getState();

  // Prioritize one orderbook relay before lower-priority onion requests.
  if (federation.connection === "nostr") {
    swallow(
      useOrderbookStore.getState().refreshOrderbook(federation.coordinators, {
        connection: federation.connection,
        hostUrl: currentHostUrl(),
        network: federation.network,
        origin: federation.origin,
        priority: "background"
      }).catch(() => undefined).then(refreshSecondaryData)
    );
    return;
  }

  swallow(refreshSecondaryData());
}

async function refreshSecondaryData(): Promise<void> {
  const cachedFederation = useFederationStore.getState();
  const coordinatorRefreshOptions = cachedFederation.coordinators.some(coordinatorNeedsHealthRecovery)
    ? { force: true, priority: "background" as const }
    : undefined;
  await Promise.all([
    cachedFederation.refreshCoordinators(coordinatorRefreshOptions),
    refreshSelectedStandardRobot(cachedFederation.coordinators, "background")
  ]);
  const refreshedFederation = useFederationStore.getState();

  if (refreshedFederation.connection === "api") {
    await useOrderbookStore.getState().refreshOrderbook(refreshedFederation.coordinators, {
      connection: refreshedFederation.connection,
      network: refreshedFederation.network,
      origin: refreshedFederation.origin,
      priority: "background"
    });
  }
}

async function refreshSelectedStandardRobotStatus(scope?: StandardRobotRefreshScope): Promise<void> {
  if (useProPreferencesStore.getState().enabled) return;
  if (isNativeApp() && !getNativeTorDiagnostics()?.connected) return;
  useGarageStore.getState().hydrate();
  const federation = useFederationStore.getState();
  await refreshSelectedStandardRobot(federation.coordinators, "visible", scope);
  void federation.refreshCoordinators().catch(() => undefined);
}

async function refreshSelectedStandardRobot(
  coordinators: CoordinatorSummary[],
  priority: "background" | "visible",
  scope?: StandardRobotRefreshScope
): Promise<void> {
  if (useProPreferencesStore.getState().enabled) return;
  const garage = useGarageStore.getState();
  const standardSlot = selectCurrentSlot(selectStandardGarageSlots(garage.slots), garage.currentToken);
  if (standardSlot) {
    const scopedAliases = scope?.orderIdsByAlias;
    const refreshCoordinators = scopedAliases
      ? coordinators.filter((coordinator) => scopedAliases.has(coordinator.shortAlias))
      : coordinators;
    const immediateOrderRefreshes: Promise<void>[] = [];
    const observedAliases = new Set<string>();
    const result = await garage.refreshRobotSlot(standardSlot.token, refreshCoordinators, {
      preferredAliases: scopedAliases ? [...scopedAliases.keys()] : preferredAliases(standardSlot),
      priority,
      source: "prewarm",
      maxAgeMs: priority === "background" ? 300_000 : 60_000,
      onCoordinatorResult: (robot) => {
        observedAliases.add(robot.shortAlias);
        const refreshedSlot = useGarageStore.getState().slots.find(
          (slot) => slot.token === standardSlot.token
        );
        if (refreshedSlot) {
          immediateOrderRefreshes.push(
            refreshStandardCoordinatorOrders(
              refreshedSlot,
              robot,
              coordinators,
              priority,
              scopedAliases?.get(robot.shortAlias)
            )
          );
        }
      }
    });
    const refreshedSlot = useGarageStore.getState().slots.find((slot) => slot.token === standardSlot.token);
    await Promise.all([
      ...immediateOrderRefreshes,
      refreshedSlot
        ? refreshStandardOrders(
            refreshedSlot,
            {
              ...result,
              coordinators: result.coordinators.filter(
                (robot) => !observedAliases.has(robot.shortAlias)
              )
            },
            coordinators,
            priority,
            scope
          )
        : Promise.resolve()
    ]);
  }
}

async function refreshStandardOrders(
  slot: RobotSlot,
  result: RefreshRobotSlotResult,
  coordinators: CoordinatorSummary[],
  priority: "background" | "visible",
  scope?: StandardRobotRefreshScope
): Promise<void> {
  await Promise.all(result.coordinators.map((robot) =>
    refreshStandardCoordinatorOrders(
      slot,
      robot,
      coordinators,
      priority,
      scope?.orderIdsByAlias?.get(robot.shortAlias)
    )
  ));
}

async function refreshStandardCoordinatorOrders(
  slot: RobotSlot,
  robot: RefreshRobotSlotResult["coordinators"][number],
  coordinators: CoordinatorSummary[],
  priority: "background" | "visible",
  notifiedOrderIds?: Set<number>
): Promise<void> {
  if (robot.error) return;
  const coordinator = coordinators.find((item) => item.shortAlias === robot.shortAlias);
  const auth = getRobotAuthForCoordinator(slot, robot.shortAlias);
  if (!coordinator?.url || !auth) return;
  const orderIds = [
    ...new Set([
      ...(notifiedOrderIds ?? []),
      robot.activeOrderId,
      robot.renewableOrderId
    ])
  ]
    .filter((orderId): orderId is number => Number.isSafeInteger(orderId) && Number(orderId) > 0);
  await Promise.all(orderIds.map(async (orderId) => {
    try {
      const order = await fetchOrder(coordinator.url, orderId, auth, {
        timeoutProfile: priority === "visible" ? "interactive" : "background",
        priority,
        source: "prewarm"
      });
      ingestCoordinatorOrder({ order, shortAlias: robot.shortAlias, slot });
    } catch {
      return;
    }
  }));
}

function scheduleDesktopNotificationRefresh(): () => void {
  if (!isTauriDesktop()) return () => undefined;
  const timer = window.setInterval(() => {
    if (
      document.visibilityState !== "visible"
      && desktopBackgroundNotificationsEnabled()
      && !useProPreferencesStore.getState().enabled
    ) {
      void refreshSelectedStandardRobotStatus().catch(() => undefined);
    }
  }, 60_000);
  return () => window.clearInterval(timer);
}

function preferredAliases(slot: ReturnType<typeof selectCurrentSlot>): string[] {
  if (!slot) return [];
  return Object.entries(slot.robots)
    .filter(([, robot]) => robot.activeOrderId || robot.renewableOrderId || robot.lastOrderId)
    .map(([alias]) => alias);
}

function scheduleIdle(callback: () => void, delayMs: number, timeout: number): () => void {
  if (typeof window === "undefined") return () => undefined;

  const idleWindow = window as unknown as IdleWindow;
  let idleId: number | undefined;
  const timer = window.setTimeout(() => {
    if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
      idleId = idleWindow.requestIdleCallback(callback, { timeout });
      return;
    }

    callback();
  }, delayMs);

  return () => {
    window.clearTimeout(timer);
    if (idleId !== undefined) {
      idleWindow.cancelIdleCallback?.(idleId);
    }
  };
}

function currentHostUrl(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.host || window.location.hostname;
}

function visibleTradeRoute(): boolean {
  return typeof window !== "undefined" && /^\/order(?:\/|$)/.test(window.location.pathname);
}

function visibleTradeMatchesOrderChange(notification: OrderChangeNotification): boolean {
  if (typeof window === "undefined") return false;
  const match = /^\/order\/([^/]+)\/(\d+)(?:\/|$)/.exec(window.location.pathname);
  if (!match) return false;
  return orderChangeMatches(notification, {
    shortAlias: decodeURIComponent(match[1]),
    orderId: Number(match[2])
  });
}

export function standardRobotRefreshScope(
  notification: OrderChangeNotification
): StandardRobotRefreshScope | undefined {
  const garage = useGarageStore.getState();
  const slot = selectCurrentSlot(selectStandardGarageSlots(garage.slots), garage.currentToken);
  if (!slot) return undefined;
  if (notification.source === "nostr") {
    if (slot.nostrPubKey.toLowerCase() !== notification.recipientPubkey.toLowerCase()) return undefined;
    return {
      orderIdsByAlias: new Map([[notification.shortAlias, new Set([notification.orderId])]])
    };
  }
  if (!notification.orderId) return {};
  const orderId = notification.orderId;
  const aliases = Object.entries(slot.robots)
    .filter(([shortAlias, robot]) => (
      (!notification.shortAlias || shortAlias === notification.shortAlias)
      && [
        robot.activeOrderId,
        robot.lastOrderId,
        robot.renewableOrderId
      ].includes(orderId)
    ))
    .map(([shortAlias]) => shortAlias);
  if (aliases.length === 0) return undefined;
  return {
    orderIdsByAlias: new Map(aliases.map((shortAlias) => [shortAlias, new Set([orderId])]))
  };
}

export function mergeStandardRefreshScopes(
  current: StandardRobotRefreshScope | undefined,
  next: StandardRobotRefreshScope
): StandardRobotRefreshScope {
  if (!current) return next;
  if (!current.orderIdsByAlias || !next.orderIdsByAlias) return {};
  const orderIdsByAlias = new Map(
    [...current.orderIdsByAlias].map(([shortAlias, orderIds]) => [
      shortAlias,
      new Set(orderIds)
    ])
  );
  for (const [shortAlias, orderIds] of next.orderIdsByAlias) {
    const mergedOrderIds = orderIdsByAlias.get(shortAlias) ?? new Set<number>();
    orderIds.forEach((orderId) => mergedOrderIds.add(orderId));
    orderIdsByAlias.set(shortAlias, mergedOrderIds);
  }
  return { orderIdsByAlias };
}

function swallow(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

function prewarmVisualAssets(): void {
  const garage = useGarageStore.getState();
  const activeSlot = selectCurrentSlot(selectStandardGarageSlots(garage.slots), garage.currentToken);

  if (activeSlot?.hashId) {
    swallow(
      import("@/domains/identity/roboavatarClient").then(({ prewarmRobotAvatar }) =>
        prewarmRobotAvatar(activeSlot.hashId)
      )
    );
  }

  const coordinatorAvatarUrls = useFederationStore
    .getState()
    .coordinators.filter((coordinator) => coordinator.shortAlias !== "local" && coordinator.enabled)
    .map((coordinator) => coordinator.smallAvatarUrl)
    .filter(Boolean)
    .slice(0, 6);

  preloadImages(coordinatorAvatarUrls);
}

function preloadImages(urls: string[]): void {
  if (typeof Image === "undefined") return;
  for (const url of urls) {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
  }
}
