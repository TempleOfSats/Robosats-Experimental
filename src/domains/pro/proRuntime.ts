import { useFederationStore } from "@/domains/coordinators/federationStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { garageReconciler } from "@/domains/pro/garageReconciler";
import {
  garageSyncEngine
} from "@/domains/pro/garageSync";
import { garageSlotsFromManifest, useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { garageTokenId } from "@/domains/pro/garageVault";
import { usePortableSettingsStore } from "@/domains/pro/portableSettingsStore";
import { startProOrderActivityBridge } from "@/domains/pro/proOrderActivity";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import { registerExpiryReconcileTrigger, registerReconcileTriggers } from "@/domains/pro/reconcileTriggers";
import type { ReconcileReason } from "@/domains/pro/pro.types";

let stopRuntime: (() => void) | undefined;

export function startProRuntime(): () => void {
  if (stopRuntime) return stopRuntime;

  useGarageStore.getState().hydrate();
  const stopVault = startGarageVaultRuntime();
  const stopOrderActivity = startProOrderActivityBridge();
  const stopTriggers = registerReconcileTriggers({
    controller: garageReconciler,
    proEnabled: () => useProPreferencesStore.getState().enabled,
    reconcileCurrent
  });
  const stopExpiryTrigger = registerExpiryReconcileTrigger(garageReconciler);
  const startupRefresh = useProPreferencesStore.getState().enabled
    ? garageReconciler.reconcileAll("startup")
    : reconcileCurrent("startup");
  void startupRefresh.catch(() => undefined);

  stopRuntime = () => {
    stopTriggers();
    stopExpiryTrigger();
    stopOrderActivity();
    stopVault();
    stopRuntime = undefined;
  };
  return stopRuntime;
}

function startGarageVaultRuntime(): () => void {
  let stopped = false;

  const applyCurrentManifest = () => {
    applyVaultManifestToGarage();
  };

  const startSyncEngine = () => {
    if (stopped || !useProPreferencesStore.getState().enabled || useGarageVaultStore.getState().status !== "ready") return;
    garageSyncEngine.start(() => useFederationStore.getState().coordinators);
  };

  const vault = useGarageVaultStore.getState();
  void vault.initialize().then(() => {
    if (stopped || useGarageVaultStore.getState().status !== "ready") return;
    applyCurrentManifest();
    usePortableSettingsStore.getState().initialize();
    startSyncEngine();
  });

  const unsubscribeVault = useGarageVaultStore.subscribe((state, previous) => {
    if (state.status === "ready" && previous.status !== "ready") {
      applyCurrentManifest();
      usePortableSettingsStore.getState().initialize();
      startSyncEngine();
      return;
    }
    if (state.envelope?.revision === previous.envelope?.revision || state.status !== "ready") return;
    if (state.manifest?.revision !== previous.manifest?.revision) applyCurrentManifest();
    usePortableSettingsStore.getState().hydrateFromVault();
    if (state.envelope?.outbox.length !== previous.envelope?.outbox.length
      || state.envelope?.outbox.some((item, index) => item.revision !== previous.envelope?.outbox[index]?.revision)) {
      garageSyncEngine.notifyMutation();
    }
  });
  const unsubscribeProPreferences = useProPreferencesStore.subscribe((state, previous) => {
    if (state.enabled === previous.enabled) return;
    if (state.enabled) startSyncEngine();
    else garageSyncEngine.stop();
  });
  const unsubscribeFederation = useFederationStore.subscribe((state, previous) => {
    if (state.coordinators === previous.coordinators) return;
    garageSyncEngine.reconfigure();
  });
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") garageSyncEngine.resume();
    else garageSyncEngine.pause();
  };
  const onResume = () => garageSyncEngine.resume();
  const onOnline = () => garageSyncEngine.resume();
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", onResume);
  window.addEventListener("online", onOnline);
  window.addEventListener("robosats:native-resume", onResume);
  const onUiPreferences = () => {
    usePortableSettingsStore.getState().captureUiPreferences();
  };
  window.addEventListener("robosats-ui-preferences", onUiPreferences);

  return () => {
    stopped = true;
    unsubscribeVault();
    unsubscribeProPreferences();
    unsubscribeFederation();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", onResume);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("robosats:native-resume", onResume);
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
      if (existing.nickname !== entry.nickname) garage.updateSlotIdentityDetails(entry.token, { nickname: entry.nickname });
      continue;
    }
    const identity = deriveRobotIdentity(entry.token);
    garage.addSlot({
      ...identity,
      nickname: entry.nickname,
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
  const slot = garage.currentSlot();
  if (!slot) return;
  await garage.refreshRobotSlot(slot.token, useFederationStore.getState().coordinators);
}
