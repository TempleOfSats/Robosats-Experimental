import { useFederationStore } from "@/domains/coordinators/federationStore";
import { selectCurrentSlot, selectStandardGarageSlots, useGarageStore } from "@/domains/garage/garageStore";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { garageReconciler } from "@/domains/pro/garageReconciler";
import {
  garageSyncEngine
} from "@/domains/pro/garageSync";
import {
  garageSlotsFromManifest,
  getGarageSecret,
  selectProGarageSlots,
  useGarageVaultStore
} from "@/domains/pro/garageVaultStore";
import { garageTokenId } from "@/domains/pro/garageVault";
import { usePortableSettingsStore } from "@/domains/pro/portableSettingsStore";
import { startProOrderActivityBridge } from "@/domains/pro/proOrderActivity";
import { replayPendingOrderChangeNotifications } from "@/domains/orders/orderChangeNotifications";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import {
  PRO_ORDER_CHANGE_CONSUMER_ID,
  registerExpiryReconcileTrigger,
  registerReconcileTriggers
} from "@/domains/pro/reconcileTriggers";
import {
  clearProTradeRuntimeCache,
  loadProTradeRuntimeCache,
  persistProTradeRuntimeCache,
  proTradeCacheOwner
} from "@/domains/pro/proTradeCache";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import {
  slotsNeedingCoordinatorRetry,
  startProRobotRefreshBridge
} from "@/domains/pro/proRobotRefreshBridge";
import type { ReconcileReason } from "@/domains/pro/pro.types";
import { subscribeRefreshIntents } from "@/domains/transport/refreshIntents";

let stopRuntime: (() => void) | undefined;

export function startProRuntime(): () => void {
  if (stopRuntime) return stopRuntime;

  useGarageStore.getState().hydrate();
  const stopVault = startGarageVaultRuntime();
  const stopOrderActivity = startProOrderActivityBridge();
  const stopRobotRefreshBridge = startProRobotRefreshBridge();
  const stopTriggers = registerReconcileTriggers({
    controller: garageReconciler,
    proEnabled: () => useProPreferencesStore.getState().enabled,
    reconcileCurrent
  });
  const stopExpiryTrigger = registerExpiryReconcileTrigger(garageReconciler);

  stopRuntime = () => {
    stopTriggers();
    stopExpiryTrigger();
    stopOrderActivity();
    stopRobotRefreshBridge();
    stopVault();
    stopRuntime = undefined;
  };
  return stopRuntime;
}

function startGarageVaultRuntime(): () => void {
  let stopped = false;
  let activeManifest: ReturnType<typeof useGarageVaultStore.getState>["manifest"];
  let portableSettingsInitialized = false;
  let coordinatorFingerprint = enabledCoordinatorFingerprint();
  let activeTradeCacheOwner: string | undefined;
  let activeTradeCacheSecret: Uint8Array | undefined;
  let stopTradeCachePersistence: (() => void) | undefined;
  let tradeCacheTimer: number | undefined;

  const activeFleetSlotIds = () => new Set(
    selectProGarageSlots(
      useGarageStore.getState().slots,
      useGarageVaultStore.getState().manifest
    ).map((slot) => slot.tokenSHA256)
  );

  const flushTradeCache = () => {
    if (tradeCacheTimer !== undefined) {
      window.clearTimeout(tradeCacheTimer);
      tradeCacheTimer = undefined;
    }
    if (!activeTradeCacheSecret) return;
    const state = useProTradeIndexStore.getState();
    persistProTradeRuntimeCache(
      activeTradeCacheSecret,
      { snapshots: state.snapshots, syncBySlot: state.syncBySlot },
      activeFleetSlotIds()
    );
  };

  const stopTradeCache = (clear = false) => {
    flushTradeCache();
    stopTradeCachePersistence?.();
    stopTradeCachePersistence = undefined;
    activeTradeCacheOwner = undefined;
    activeTradeCacheSecret = undefined;
    if (clear) {
      clearProTradeRuntimeCache();
      useProTradeIndexStore.getState().resetRuntimeCache();
    }
  };

  const configureTradeCache = () => {
    const secret = getGarageSecret();
    if (!secret) return;
    const owner = proTradeCacheOwner(secret);
    const slotIds = activeFleetSlotIds();
    if (owner === activeTradeCacheOwner) {
      useProTradeIndexStore.getState().retainSlots(slotIds);
      return;
    }

    stopTradeCache();
    activeTradeCacheOwner = owner;
    activeTradeCacheSecret = secret;
    useProTradeIndexStore.getState().resetRuntimeCache();
    const cached = loadProTradeRuntimeCache(secret, slotIds);
    useProTradeIndexStore.getState().hydrateRuntimeCache(cached.snapshots, cached.syncBySlot);
    stopTradeCachePersistence = useProTradeIndexStore.subscribe((state, previous) => {
      if (state.snapshots === previous.snapshots && state.syncBySlot === previous.syncBySlot) return;
      if (tradeCacheTimer !== undefined) window.clearTimeout(tradeCacheTimer);
      tradeCacheTimer = window.setTimeout(flushTradeCache, 500);
    });
  };

  const startSyncEngine = () => {
    if (stopped || !useProPreferencesStore.getState().enabled || useGarageVaultStore.getState().status !== "ready") return;
    garageSyncEngine.start(() => useFederationStore.getState().coordinators);
  };

  const activateFleet = (forceReconcile = false) => {
    const state = useGarageVaultStore.getState();
    if (stopped || state.status !== "ready") return;
    const manifestChanged = state.manifest !== activeManifest;
    if (manifestChanged) {
      activeManifest = state.manifest;
      applyVaultManifestToGarage();
      configureTradeCache();
    }
    if (!portableSettingsInitialized) {
      portableSettingsInitialized = true;
      usePortableSettingsStore.getState().initialize();
    }
    startSyncEngine();
    if (useProPreferencesStore.getState().enabled) {
      replayPendingOrderChangeNotifications(PRO_ORDER_CHANGE_CONSUMER_ID);
    }
    if (useProPreferencesStore.getState().enabled && (manifestChanged || forceReconcile)) {
      void garageReconciler.reconcileAll("fleet-ready").catch(() => undefined);
    }
  };

  const vault = useGarageVaultStore.getState();
  void vault.initialize().then(() => {
    activateFleet();
  });

  const unsubscribeVault = useGarageVaultStore.subscribe((state, previous) => {
    if (state.status !== "ready" && previous.status === "ready") {
      stopTradeCache(state.status === "unconfigured");
    }
    if (state.status === "ready" && previous.status !== "ready") {
      activateFleet();
      return;
    }
    if (state.status !== "ready" || state.envelope === previous.envelope) return;
    if (state.manifest !== previous.manifest) activateFleet();
    usePortableSettingsStore.getState().hydrateFromVault();
    if (state.envelope?.outbox.length !== previous.envelope?.outbox.length
      || state.envelope?.outbox.some((item, index) => item.revision !== previous.envelope?.outbox[index]?.revision)) {
      garageSyncEngine.notifyMutation();
    }
  });
  const unsubscribeProPreferences = useProPreferencesStore.subscribe((state, previous) => {
    if (state.enabled === previous.enabled) return;
    if (state.enabled) activateFleet(true);
    else garageSyncEngine.stop();
  });
  const unsubscribeFederation = useFederationStore.subscribe((state, previous) => {
    if (state.coordinators === previous.coordinators) return;
    if (useProPreferencesStore.getState().enabled) {
      replayPendingOrderChangeNotifications(PRO_ORDER_CHANGE_CONSUMER_ID);
    }
    garageSyncEngine.reconfigure();
    const nextFingerprint = enabledCoordinatorFingerprint();
    if (nextFingerprint !== coordinatorFingerprint) {
      coordinatorFingerprint = nextFingerprint;
      if (nextFingerprint) {
        activateFleet(true);
        return;
      }
    }
    if (nextFingerprint && useGarageVaultStore.getState().status === "ready") {
      const slotIds = selectProGarageSlots(
        useGarageStore.getState().slots,
        useGarageVaultStore.getState().manifest
      ).map((slot) => slot.tokenSHA256);
      const retrySlotIds = slotsNeedingCoordinatorRetry(
        slotIds,
        useProTradeIndexStore.getState().syncBySlot
      );
      for (const slotId of retrySlotIds) {
        void garageReconciler.reconcileSlot(slotId, "fleet-ready").catch(() => undefined);
      }
    }
  });
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") garageSyncEngine.resume();
    else garageSyncEngine.pause();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const stopLifecycle = subscribeRefreshIntents((reason) => {
    if (reason === "resume" || reason === "online" || reason === "tor-ready" || reason === "tor-reconnected") {
      garageSyncEngine.resume();
    }
  });
  const onUiPreferences = () => {
    usePortableSettingsStore.getState().captureUiPreferences();
  };
  window.addEventListener("robosats-ui-preferences", onUiPreferences);

  return () => {
    stopped = true;
    stopTradeCache();
    unsubscribeVault();
    unsubscribeProPreferences();
    unsubscribeFederation();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    stopLifecycle();
    window.removeEventListener("robosats-ui-preferences", onUiPreferences);
    garageSyncEngine.stop();
  };
}

function applyVaultManifestToGarage(): void {
  const manifest = useGarageVaultStore.getState().manifest;
  const garage = useGarageStore.getState();
  if (!manifest) return;
  const selectedToken = garage.currentToken;
  for (const entry of garageSlotsFromManifest(manifest)) {
    const existing = useGarageStore.getState().slots.find((slot) => slot.token === entry.token);
    if (existing) {
      if (existing.nickname !== entry.nickname || existing.managedBy !== "fleet") {
        garage.addSlot({ ...existing, nickname: entry.nickname, managedBy: "fleet" });
      }
      continue;
    }
    const identity = deriveRobotIdentity(entry.token);
    garage.addSlot({
      ...identity,
      nickname: entry.nickname,
      managedBy: "fleet",
      earnedRewards: 0,
      robots: {
        local: {
          token: entry.token,
          shortAlias: "local",
          nostrPubKey: identity.nostrPubKey,
          tokenSHA256: identity.tokenSHA256,
          earnedRewards: 0
        }
      }
    });
  }
  for (const slot of useGarageStore.getState().slots) {
    const entry = manifest.entries.find((candidate) => candidate.tokenId === garageTokenId(slot.token));
    const hasRelevantOrder = Object.values(slot.robots).some((robot) => robot.activeOrderId || robot.renewableOrderId);
    if (entry?.deleted && !hasRelevantOrder) garage.removeSlot(slot.token);
  }
  if (selectedToken && useGarageStore.getState().slots.some((slot) => slot.token === selectedToken)) {
    garage.setCurrentToken(selectedToken);
  }
}

export function stopProRuntime(): void {
  stopRuntime?.();
}

export async function syncAllProDataNow(
  _coordinators = useFederationStore.getState().coordinators,
  options: { forcePublish?: boolean } = {}
): Promise<void> {
  garageSyncEngine.reconfigure();
  await garageSyncEngine.synchronize(options);
}

async function reconcileCurrent(_reason: ReconcileReason): Promise<void> {
  const garage = useGarageStore.getState();
  const slot = selectCurrentSlot(selectStandardGarageSlots(garage.slots), garage.currentToken);
  if (!slot) return;
  await garage.refreshRobotSlot(slot.token, useFederationStore.getState().coordinators);
}

function enabledCoordinatorFingerprint(): string {
  return useFederationStore.getState().coordinators
    .filter((coordinator) => coordinator.enabled && coordinator.url && coordinator.shortAlias !== "local")
    .map((coordinator) => `${coordinator.shortAlias}:${coordinator.url}`)
    .sort()
    .join("|");
}
