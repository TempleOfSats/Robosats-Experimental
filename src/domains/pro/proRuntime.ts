import { useFederationStore } from "@/domains/coordinators/federationStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import { garageReconciler } from "@/domains/pro/garageReconciler";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import { registerReconcileTriggers } from "@/domains/pro/reconcileTriggers";
import type { ReconcileReason } from "@/domains/pro/pro.types";

let stopRuntime: (() => void) | undefined;

export function startProRuntime(): () => void {
  if (stopRuntime) return stopRuntime;

  const stopTriggers = registerReconcileTriggers({
    controller: garageReconciler,
    proEnabled: () => useProPreferencesStore.getState().enabled,
    reconcileCurrent
  });
  const startupRefresh = useProPreferencesStore.getState().enabled
    ? garageReconciler.reconcileAll("startup")
    : reconcileCurrent("startup");
  void startupRefresh.catch(() => undefined);

  stopRuntime = () => {
    stopTriggers();
    stopRuntime = undefined;
  };
  return stopRuntime;
}

export function stopProRuntime(): void {
  stopRuntime?.();
}

async function reconcileCurrent(_reason: ReconcileReason): Promise<void> {
  const garage = useGarageStore.getState();
  const slot = garage.currentSlot();
  if (!slot) return;
  await garage.refreshRobotSlot(slot.token, useFederationStore.getState().coordinators);
}
