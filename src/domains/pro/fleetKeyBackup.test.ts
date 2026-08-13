import { describe, expect, it } from "vitest";
import {
  buildFleetKeyBackup,
  buildOfflineFleetBackup,
  MAX_FLEET_BACKUP_FILE_BYTES,
  parseFleetBackupFile
} from "@/domains/pro/fleetKeyBackup";
import {
  createGarageManifest,
  deriveGarageRobotToken,
  encodeGarageToken,
  garageTokenId,
  removeGarageEntry,
  upsertGarageEntry
} from "@/domains/pro/garageVault";

const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const fleetKey = encodeGarageToken(secret);
const entryId = "1234567890abcdef1234567890abcdef";
let manifest = upsertGarageEntry(
  createGarageManifest("00112233445566778899aabbccddeeff", 1),
  {
    id: entryId,
    tokenId: garageTokenId(deriveGarageRobotToken(secret, entryId)),
    nickname: "Offline robot"
  },
  2
);
const retiredId = "2234567890abcdef1234567890abcdef";
manifest = upsertGarageEntry(
  manifest,
  {
    id: retiredId,
    tokenId: garageTokenId(deriveGarageRobotToken(secret, retiredId)),
    nickname: "Retired robot"
  },
  3
);
manifest = removeGarageEntry(manifest, retiredId, 4);

describe("offline Fleet backup", () => {
  it("keeps the first-run key download compatible and normalized", () => {
    expect(buildFleetKeyBackup(`  ${fleetKey}\n`)).toEqual({
      format: "robosats-exp-fleet-key",
      version: 1,
      fleetKey
    });
    expect(() => buildFleetKeyBackup("not-a-fleet-key")).toThrow("Invalid Fleet key");
  });

  it("round trips an authenticated robot manifest without exposing robot details", () => {
    const backup = buildOfflineFleetBackup(`  ${fleetKey}\n`, manifest, 123);
    const serialized = JSON.stringify(backup);
    const robotToken = deriveGarageRobotToken(secret, entryId);

    expect(backup).toMatchObject({
      format: "robosats-exp-fleet-backup",
      version: 1,
      fleetKey
    });
    expect(serialized).not.toContain(entryId);
    expect(serialized).not.toContain(retiredId);
    expect(serialized).not.toContain("Offline robot");
    expect(serialized).not.toContain(robotToken);
    expect(parseFleetBackupFile(serialized)).toEqual({
      fleetKey,
      robotSnapshot: {
        format: "robosats-exp-fleet-robots",
        version: 1,
        createdAt: 123,
        garage: manifest
      }
    });
    expect(parseFleetBackupFile(serialized).robotSnapshot?.garage.entries[1]?.deleted).toBe(true);
  });

  it("accepts the previous key-only backup as a relay recovery fallback", () => {
    expect(
      parseFleetBackupFile(
        JSON.stringify({
          format: "robosats-exp-fleet-key",
          version: 1,
          fleetKey
        })
      )
    ).toEqual({ fleetKey });
  });

  it("rejects damaged, mismatched, unknown, and oversized files", () => {
    const backup = buildOfflineFleetBackup(fleetKey, manifest, 123);
    const replacement = backup.encryptedRobots[20] === "A" ? "B" : "A";
    const damaged = {
      ...backup,
      encryptedRobots: `${backup.encryptedRobots.slice(0, 20)}${replacement}${backup.encryptedRobots.slice(21)}`
    };
    const otherKey = encodeGarageToken(Uint8Array.from({ length: 32 }, (_, index) => index + 2));

    expect(() => parseFleetBackupFile(JSON.stringify(damaged))).toThrow("damaged or does not match");
    expect(() => parseFleetBackupFile(JSON.stringify({ ...backup, fleetKey: otherKey }))).toThrow(
      "damaged or does not match"
    );
    expect(() => parseFleetBackupFile(JSON.stringify({ ...backup, extra: true }))).toThrow("unknown fields");
    expect(() => parseFleetBackupFile("not-json")).toThrow("not a valid Fleet backup");
    expect(() => parseFleetBackupFile("x".repeat(MAX_FLEET_BACKUP_FILE_BYTES + 1))).toThrow("too large");
  });
});
