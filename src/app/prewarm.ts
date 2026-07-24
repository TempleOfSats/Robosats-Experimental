import { preloadAllAppRoutes, preloadPrimaryTradeRoutes } from "@/app/routes";
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
import { startOrderChangeHintRuntime } from "@/domains/nostr/orderChangeHints";
import { ingestCoordinatorOrder } from "@/domains/orders/orderActivity";
import { fetchOrder } from "@/domains/orders/orderApi";
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

export function scheduleAppPrewarm(): () => void {
  const stopOrderChangeHints = startOrderChangeHintRuntime();
  let foregroundRefresh: Promise<void> | undefined;
  const refreshAfterLifecycle = (reason: RefreshReason) => {
    if (reason === "tor-ready") {
      prewarmData();
      return;
    }
    if (foregroundRefresh || (visibleTradeRoute() && document.visibilityState === "visible")) return;
    foregroundRefresh = refreshSelectedStandardRobotStatus()
      .catch(() => undefined)
      .finally(() => { foregroundRefresh = undefined; });
  };
  const stopLifecycle = subscribeRefreshIntents(refreshAfterLifecycle);

  const cleanups = [
    scheduleIdle(prewarmData, 500, 3000),
    scheduleIdle(preloadPrimaryTradeRoutes, 1800, 6000),
    scheduleIdle(preloadAllAppRoutes, 4500, 12000),
    scheduleIdle(prewarmVisualAssets, 7000, 16000),
    scheduleIdle(prewarmAudioAssets, 45000, 60000),
    scheduleDesktopNotificationRefresh()
  ];

  return () => {
    stopOrderChangeHints();
    stopLifecycle();
    cleanups.forEach((cleanup) => cleanup());
  };
}

export function prewarmActiveRobotTradeData(): void {
  prewarmData();
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
        origin: federation.origin
      }).catch(() => undefined).then(refreshSecondaryData)
    );
    return;
  }

  swallow(refreshSecondaryData());
}

async function refreshSecondaryData(): Promise<void> {
  const cachedFederation = useFederationStore.getState();
  await Promise.all([
    cachedFederation.refreshCoordinators(),
    refreshSelectedStandardRobot(cachedFederation.coordinators, "background")
  ]);
  const refreshedFederation = useFederationStore.getState();

  if (refreshedFederation.connection === "api") {
    await useOrderbookStore.getState().refreshOrderbook(refreshedFederation.coordinators, {
      connection: refreshedFederation.connection,
      network: refreshedFederation.network,
      origin: refreshedFederation.origin
    });
  }
}

async function refreshSelectedStandardRobotStatus(): Promise<void> {
  if (useProPreferencesStore.getState().enabled) return;
  if (isNativeApp() && !getNativeTorDiagnostics()?.connected) return;
  useGarageStore.getState().hydrate();
  const federation = useFederationStore.getState();
  await refreshSelectedStandardRobot(federation.coordinators, "visible");
  void federation.refreshCoordinators().catch(() => undefined);
}

async function refreshSelectedStandardRobot(
  coordinators: CoordinatorSummary[],
  priority: "background" | "visible"
): Promise<void> {
  if (useProPreferencesStore.getState().enabled) return;
  const garage = useGarageStore.getState();
  const standardSlot = selectCurrentSlot(selectStandardGarageSlots(garage.slots), garage.currentToken);
  if (standardSlot) {
    const result = await garage.refreshRobotSlot(standardSlot.token, coordinators, {
      preferredAliases: preferredAliases(standardSlot),
      priority,
      source: "prewarm"
    });
    const refreshedSlot = useGarageStore.getState().slots.find((slot) => slot.token === standardSlot.token);
    if (refreshedSlot) await refreshStandardOrders(refreshedSlot, result, coordinators);
  }
}

async function refreshStandardOrders(
  slot: RobotSlot,
  result: RefreshRobotSlotResult,
  coordinators: CoordinatorSummary[]
): Promise<void> {
  const coordinatorsByAlias = new Map(coordinators.map((coordinator) => [coordinator.shortAlias, coordinator]));
  await Promise.all(result.coordinators.flatMap((robot) => {
    if (robot.error) return [];
    const coordinator = coordinatorsByAlias.get(robot.shortAlias);
    const auth = getRobotAuthForCoordinator(slot, robot.shortAlias);
    if (!coordinator?.url || !auth) return [];
    const orderIds = [...new Set([robot.activeOrderId, robot.renewableOrderId])]
      .filter((orderId): orderId is number => Number.isSafeInteger(orderId) && Number(orderId) > 0);
    return orderIds.map(async (orderId) => {
      try {
        const order = await fetchOrder(coordinator.url, orderId, auth, {
          timeoutProfile: "background",
          priority: "background",
          source: "prewarm"
        });
        ingestCoordinatorOrder({ order, shortAlias: robot.shortAlias, slot });
      } catch {
        return;
      }
    });
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

function swallow(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

function prewarmVisualAssets(): void {
  const garage = useGarageStore.getState();
  const activeSlot = selectCurrentSlot(selectStandardGarageSlots(garage.slots), garage.currentToken);

  if (activeSlot?.hashId) {
    swallow(
      import("@/domains/identity/roboidentitiesClient").then(({ prewarmRobohashes }) =>
        prewarmRobohashes(activeSlot.hashId)
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

function prewarmAudioAssets(): void {
  swallow(import("@/domains/audio/audioController").then(({ preloadTradeAudio }) => preloadTradeAudio()));
}

function preloadImages(urls: string[]): void {
  if (typeof Image === "undefined") return;
  for (const url of urls) {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
  }
}
