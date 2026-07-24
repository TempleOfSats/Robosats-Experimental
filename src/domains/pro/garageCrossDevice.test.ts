import { describe, expect, it } from "vitest";
import { buildGarageRecordEvent, decodeGarageRecordEvent } from "@/domains/pro/garageSync";
import { recoverySnapshotFromRecords } from "@/domains/pro/garageVaultStore";
import {
  activeGarageEntries,
  createGarageManifest,
  deriveGarageRobotToken,
  garageTokenId,
  removeGarageEntry,
  upsertGarageEntry
} from "@/domains/pro/garageVault";
import { createPortableSettingsManifest, saveOfferPreset, updatePortablePreferences } from "@/domains/pro/portableSettings";
import { preferencesToSyncRecord, presetToSyncRecord, robotEntryToSyncRecord } from "@/domains/pro/garageSyncRecords";

const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const deviceA = "00112233445566778899aabbccddeeff";
const deviceB = "ffeeddccbbaa99887766554433221100";
const robotId = "b".repeat(32);

describe("record-based cross-device convergence", () => {
  it("resolves concurrent active edits identically regardless of arrival order", () => {
    const tokenId = garageTokenId(deriveGarageRobotToken(secret, robotId));
    const first = {
      type: "robot" as const,
      version: 1 as const,
      id: robotId,
      tokenId,
      nickname: "Device A",
      revision: 2,
      writerDeviceId: deviceA,
      updatedAt: 2
    };
    const second = { ...first, nickname: "Device B", writerDeviceId: deviceB };
    const firstEvent = decodeGarageRecordEvent(buildGarageRecordEvent(secret, first, 10), secret)!;
    const secondEvent = decodeGarageRecordEvent(buildGarageRecordEvent(secret, second, 10), secret)!;

    const forward = recoverySnapshotFromRecords(secret, [firstEvent, secondEvent], deviceA);
    const reverse = recoverySnapshotFromRecords(secret, [secondEvent, firstEvent], deviceA);

    expect(activeGarageEntries(forward.garage)[0].nickname).toBe("Device B");
    expect(activeGarageEntries(reverse.garage)[0].nickname).toBe("Device B");
  });

  it("keeps a tombstone authoritative over a stale active robot", () => {
    let garage = upsertGarageEntry(createGarageManifest(deviceA, 1), {
      id: robotId,
      nickname: "Robot A",
      tokenId: garageTokenId(deriveGarageRobotToken(secret, robotId))
    }, 2);
    const active = robotEntryToSyncRecord(garage.entries[0]);
    garage = removeGarageEntry(garage, robotId, 3);
    const removed = robotEntryToSyncRecord(garage.entries[0]);
    const concurrentActive = { ...active, revision: 99, writerDeviceId: deviceB, updatedAt: 4 };
    const records = [
      decodeGarageRecordEvent(buildGarageRecordEvent(secret, removed, 11), secret)!,
      decodeGarageRecordEvent(buildGarageRecordEvent(secret, concurrentActive, 12), secret)!
    ];
    const recovered = recoverySnapshotFromRecords(secret, records, deviceB);
    expect(activeGarageEntries(recovered.garage)).toHaveLength(0);
    expect(recovered.garage.entries[0]).toMatchObject({ id: robotId, deleted: true, nickname: "" });
    expect(recovered.garage.entries[0]).not.toHaveProperty("token");
  });

  it("recovers preferences and presets from independent records", () => {
    let settings = createPortableSettingsManifest(deviceA, { theme: "dark" }, 1);
    settings = updatePortablePreferences(settings, { theme: "light" }, 2);
    settings = saveOfferPreset(settings, {
      id: "d".repeat(32),
      name: "Morning buy",
      direction: 0,
      isSwap: false,
      currency: "EUR",
      amount: "100",
      paymentMethods: ["SEPA"],
      premium: 1,
      bond: 3,
      publicDuration: 86_400,
      escrowDuration: 10_800,
      description: "Morning settlement",
      password: ""
    }, 3);
    const records = [preferencesToSyncRecord(settings), presetToSyncRecord(settings.presets[0])]
      .map((record, index) => decodeGarageRecordEvent(buildGarageRecordEvent(secret, record, 20 + index), secret)!);
    const recovered = recoverySnapshotFromRecords(secret, records, deviceB);
    expect(recovered.settings.theme.value).toBe("light");
    expect(recovered.settings.presets[0].name).toBe("Morning buy");
    expect(recovered.settings.presets[0].description).toBe("Morning settlement");
  });
});
