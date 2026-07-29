import type { GarageSyncStatus } from "@/domains/pro/garageVaultStore";

const FLEET_RESTORE_DETAIL = "Your Fleet key privately restores your synced robots, offer presets and completed-trade history on any device.";

export type FleetProtectionPresentation = {
  label: "Fleet synced" | "Fleet syncing";
  detail: string;
  tone: "synced" | "syncing";
};

export function fleetProtectionPresentation(
  syncStatus: GarageSyncStatus,
  pendingChanges: number,
  hasSynchronizedRecords: boolean
): FleetProtectionPresentation {
  if (
    syncStatus === "saving"
    || pendingChanges > 0
    || (!hasSynchronizedRecords && syncStatus !== "up-to-date")
  ) {
    return {
      label: "Fleet syncing",
      detail: FLEET_RESTORE_DETAIL,
      tone: "syncing"
    };
  }

  return {
    label: "Fleet synced",
    detail: FLEET_RESTORE_DETAIL,
    tone: "synced"
  };
}
