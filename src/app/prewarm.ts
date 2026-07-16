import { preloadAllAppRoutes, preloadPrimaryTradeRoutes } from "@/app/routes";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import { useOrderbookStore } from "@/domains/orderbook/orderbookStore";
import { getNativeTorDiagnostics, isNativeApp } from "@/domains/transport/androidBridge";

type IdleWindow = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function scheduleAppPrewarm(): () => void {
  const onTorReady = () => prewarmData();
  window.addEventListener("robosats:tor-reconnected", onTorReady);

  const cleanups = [
    scheduleIdle(prewarmData, 500, 3000),
    scheduleIdle(preloadPrimaryTradeRoutes, 1800, 6000),
    scheduleIdle(preloadAllAppRoutes, 4500, 12000),
    scheduleIdle(prewarmVisualAssets, 7000, 16000),
    scheduleIdle(prewarmAudioAssets, 45000, 60000)
  ];

  return () => {
    window.removeEventListener("robosats:tor-reconnected", onTorReady);
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
  await useFederationStore.getState().refreshCoordinators();
  const refreshedFederation = useFederationStore.getState();
  const refreshedGarage = useGarageStore.getState();

  if (refreshedFederation.connection === "api") {
    await useOrderbookStore.getState().refreshOrderbook(refreshedFederation.coordinators, {
      connection: refreshedFederation.connection,
      network: refreshedFederation.network,
      origin: refreshedFederation.origin
    });
  }

  if (refreshedGarage.currentSlot()) {
    await refreshedGarage.refreshRobots(refreshedFederation.coordinators);
  }
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

function swallow(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

function prewarmVisualAssets(): void {
  const garage = useGarageStore.getState();
  const activeSlot = garage.currentSlot();

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
