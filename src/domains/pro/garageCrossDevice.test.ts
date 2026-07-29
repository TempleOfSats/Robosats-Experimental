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
import {
  preferencesToSyncRecord,
  presetToSyncRecord,
  robotEntryToSyncRecord,
  tradeHistoryToSyncRecord
} from "@/domains/pro/garageSyncRecords";
import { tradeHistoryEntryFromOrder } from "@/domains/pro/tradeHistory";
import type { OrderDto } from "@/domains/orders/order.types";

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

  it("recovers sanitized finished trades from independent history records", () => {
    const entry = tradeHistoryEntryFromOrder({
      slotId: "c".repeat(64),
      robotName: "Finished Robot",
      robotHashId: "robot-hash",
      coordinatorShortAlias: "lake",
      order: completedOrder(),
      observedAt: Date.now()
    }, deviceA)!;
    const event = decodeGarageRecordEvent(
      buildGarageRecordEvent(secret, tradeHistoryToSyncRecord(entry), 30),
      secret
    )!;

    const recovered = recoverySnapshotFromRecords(secret, [event], deviceB);
    expect(recovered.history.entries).toHaveLength(1);
    expect(recovered.history.entries[0]).toMatchObject({
      robotName: "Finished Robot",
      orderId: 42,
      outcome: "completed"
    });
    expect(JSON.stringify(recovered.history)).not.toContain("ln-sensitive");
  });
});

function completedOrder(): OrderDto {
  return {
    id: 42,
    status: 14,
    type: 0,
    amount: 100,
    currency: 1,
    payment_method: "SEPA",
    premium: 0,
    satoshis: 1_000,
    is_maker: false,
    is_taker: true,
    is_buyer: true,
    is_seller: false,
    maker_nick: "Maker",
    maker_hash_id: "maker",
    taker_nick: "Taker",
    taker_hash_id: "taker",
    bond_invoice: "ln-sensitive",
    bond_satoshis: 0,
    escrow_invoice: "",
    escrow_satoshis: 0,
    invoice_amount: 0,
    swap_allowed: false,
    suggested_mining_fee_rate: 0,
    swap_fee_rate: 0,
    expires_at: "2026-07-23T12:00:00Z",
    shortAlias: "lake"
  };
}
