import { decryptGaragePayload, encryptGaragePayload } from "@/domains/pro/garageCrypto";
import {
  decodeGarageToken,
  encodeGarageToken,
  validateGarageManifestForSecret,
  type GarageManifest
} from "@/domains/pro/garageVault";
import { downloadTextFile } from "@/domains/transport/downloadFile";

const encoder = new TextEncoder();

export const MAX_FLEET_BACKUP_FILE_BYTES = 128 * 1024;

type FleetKeyBackup = {
  format: "robosats-exp-fleet-key";
  version: 1;
  fleetKey: string;
};

type OfflineFleetRobotSnapshot = {
  format: "robosats-exp-fleet-robots";
  version: 1;
  createdAt: number;
  garage: GarageManifest;
};

export type OfflineFleetBackup = {
  format: "robosats-exp-fleet-backup";
  version: 1;
  fleetKey: string;
  encryptedRobots: string;
};

export type ParsedFleetBackup = {
  fleetKey: string;
  robotSnapshot?: OfflineFleetRobotSnapshot;
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

export function buildOfflineFleetBackup(
  fleetKey: string,
  garage: GarageManifest,
  createdAt = Date.now()
): OfflineFleetBackup {
  const secret = decodeGarageToken(fleetKey.trim());
  const normalized = encodeGarageToken(secret);
  validateGarageManifestForSecret(garage, secret);
  const snapshot: OfflineFleetRobotSnapshot = {
    format: "robosats-exp-fleet-robots",
    version: 1,
    createdAt,
    garage
  };
  return {
    format: "robosats-exp-fleet-backup",
    version: 1,
    fleetKey: normalized,
    encryptedRobots: encryptGaragePayload(secret, "offline-backup", JSON.stringify(snapshot))
  };
}

export function parseFleetBackupFile(content: string): ParsedFleetBackup {
  if (encoder.encode(content).length > MAX_FLEET_BACKUP_FILE_BYTES) {
    throw new Error("This Fleet backup is too large.");
  }

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("This is not a valid Fleet backup file.");
  }
  if (!value || typeof value !== "object") throw new Error("This is not a valid Fleet backup file.");

  const backup = value as Record<string, unknown>;
  if (backup.format === "robosats-exp-fleet-key") return parseLegacyFleetKeyBackup(value);
  if (backup.format !== "robosats-exp-fleet-backup" || backup.version !== 1) {
    throw new Error("This Fleet backup format is not supported.");
  }
  if (hasUnknownFields(value, ["format", "version", "fleetKey", "encryptedRobots"])) {
    throw new Error("This Fleet backup contains unknown fields.");
  }
  if (typeof backup.fleetKey !== "string" || typeof backup.encryptedRobots !== "string") {
    throw new Error("This Fleet backup is incomplete.");
  }

  try {
    const secret = decodeGarageToken(backup.fleetKey);
    const fleetKey = encodeGarageToken(secret);
    const decrypted = decryptGaragePayload(secret, "offline-backup", backup.encryptedRobots);
    const robotSnapshot = JSON.parse(decrypted) as unknown;
    validateOfflineRobotSnapshot(robotSnapshot, secret);
    return { fleetKey, robotSnapshot };
  } catch {
    throw new Error("This Fleet backup is damaged or does not match its key.");
  }
}

export function downloadOfflineFleetBackup(fleetKey: string, garage: GarageManifest): void {
  const payload = JSON.stringify(buildOfflineFleetBackup(fleetKey, garage), null, 2);
  downloadTextFile("robosats-pro-fleet-backup.json", payload, "application/json");
}

function parseLegacyFleetKeyBackup(value: object): ParsedFleetBackup {
  if (hasUnknownFields(value, ["format", "version", "fleetKey"])) {
    throw new Error("This Fleet key backup contains unknown fields.");
  }
  const backup = value as Partial<FleetKeyBackup>;
  if (backup.version !== 1 || typeof backup.fleetKey !== "string") {
    throw new Error("This Fleet key backup is not supported.");
  }
  const secret = decodeGarageToken(backup.fleetKey);
  return { fleetKey: encodeGarageToken(secret) };
}

function validateOfflineRobotSnapshot(value: unknown, secret: Uint8Array): asserts value is OfflineFleetRobotSnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid Fleet robot snapshot.");
  if (hasUnknownFields(value, ["format", "version", "createdAt", "garage"])) {
    throw new Error("Fleet robot snapshot has unknown fields.");
  }
  const snapshot = value as Partial<OfflineFleetRobotSnapshot>;
  if (snapshot.format !== "robosats-exp-fleet-robots" || snapshot.version !== 1) {
    throw new Error("Unsupported Fleet robot snapshot.");
  }
  if (!Number.isSafeInteger(snapshot.createdAt) || Number(snapshot.createdAt) < 0) {
    throw new Error("Invalid Fleet backup timestamp.");
  }
  validateGarageManifestForSecret(snapshot.garage, secret);
}

function hasUnknownFields(value: object, allowed: string[]): boolean {
  const fields = new Set(allowed);
  return Object.keys(value).some((key) => !fields.has(key));
}
