import type { GarageSyncStatus } from "@/domains/pro/garageVaultStore";

const FLEET_RESTORE_DETAIL = "Your Fleet key privately restores your synced robots, offer presets and completed-trade history on any device.";

export type FleetProtectionPresentation = {
  label: "Fleet synced" | "Fleet syncing" | "Sync pending";
  detail: string;
  tone: "synced" | "syncing" | "pending";
};

export function fleetProtectionPresentation(
  syncStatus: GarageSyncStatus,
  pendingChanges: number,
  hasSynchronizedRecords: boolean
): FleetProtectionPresentation {
  if (syncStatus === "saving") {
    return {
      label: "Fleet syncing",
      detail: FLEET_RESTORE_DETAIL,
      tone: "syncing"
    };
  }

  if (pendingChanges > 0 || (!hasSynchronizedRecords && syncStatus !== "up-to-date")) {
    return {
      label: "Sync pending",
      detail: "Fleet changes are saved on this device and will retry privately when Tor relays are reachable.",
      tone: "pending"
    };
  }

  return {
    label: "Fleet synced",
    detail: FLEET_RESTORE_DETAIL,
    tone: "synced"
  };
}
