import { decodeGarageToken } from "@/domains/pro/garageVault";

export type FleetKeyBackup = {
  format: "robosats-exp-fleet-key";
  version: 1;
  fleetKey: string;
};

export function buildFleetKeyBackup(fleetKey: string): FleetKeyBackup {
  const normalized = fleetKey.trim();
  decodeGarageToken(normalized);
  return {
    format: "robosats-exp-fleet-key",
    version: 1,
    fleetKey: normalized
  };
}

export function downloadFleetKeyBackup(fleetKey: string): void {
  const payload = JSON.stringify(buildFleetKeyBackup(fleetKey), null, 2);
  const href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "robosats-pro-fleet-key.json";
  anchor.click();
  URL.revokeObjectURL(href);
}
