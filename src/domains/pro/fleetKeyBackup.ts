import { decodeGarageToken } from "@/domains/pro/garageVault";
import { downloadTextFile } from "@/domains/transport/downloadFile";

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
  downloadTextFile("robosats-pro-fleet-key.json", payload, "application/json");
}
