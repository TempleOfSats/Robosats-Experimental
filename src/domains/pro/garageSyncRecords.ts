import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { GarageKeyDomain } from "@/domains/pro/garageCrypto";
import { deriveGarageDomainKey } from "@/domains/pro/garageCrypto";
import {
  deriveGarageRobotToken,
  garageTokenId,
  type GarageRobotEntry
} from "@/domains/pro/garageVault";
import { validatePortableSettings, type OfferPreset, type PortableSettingsManifest } from "@/domains/pro/portableSettings";
import { validateTradeHistoryEntry, type TradeHistoryEntry } from "@/domains/pro/tradeHistory";
import type { UiTheme } from "@/domains/settings/uiPreferences";

const encoder = new TextEncoder();

export const GARAGE_SYNC_LIMITS = {
  eventBytes: 16 * 1024,
  outbox: 320,
  plaintextBytes: 8 * 1024,
  queryPageRecords: 400,
  queryRecords: 4_000,
  publishBatch: 8
} as const;

type RecordBase = {
  version: 1;
  id: string;
  revision: number;
  writerDeviceId: string;
  updatedAt: number;
};

export type GarageRobotRecord = RecordBase & {
  type: "robot";
  tokenId: string;
  nickname: string;
};

export type GarageRobotTombstone = RecordBase & {
  type: "robot-tombstone";
  tokenId: string;
};

export type GaragePresetRecord = RecordBase & {
  type: "preset";
  value: Omit<OfferPreset, "id" | "revision" | "deviceId" | "deleted" | "updatedAt">;
};

export type GaragePresetTombstone = RecordBase & {
  type: "preset-tombstone";
};

export type GaragePreferencesRecord = RecordBase & {
  type: "preferences";
  theme: UiTheme;
};

export type GarageTradeHistoryRecord = RecordBase & {
  type: "trade-history";
  value: Omit<TradeHistoryEntry, "id" | "revision" | "deviceId" | "updatedAt">;
};

export type GarageSyncRecord =
  | GarageRobotRecord
  | GarageRobotTombstone
  | GaragePresetRecord
  | GaragePresetTombstone
  | GaragePreferencesRecord
  | GarageTradeHistoryRecord;

export type ObservedGarageSyncRecord = {
  record: GarageSyncRecord;
  eventId: string;
  publishedAt: number;
};

export type GarageOutboxItem = {
  key: string;
  revision: number;
  queuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  acceptedRelays: string[];
  acceptedEventId?: string;
  acceptedPublishedAt?: number;
};

export type GarageObservedEvent = {
  eventId: string;
  publishedAt: number;
  revision: number;
  writerDeviceId: string;
};

export function robotEntryToSyncRecord(entry: GarageRobotEntry): GarageRobotRecord | GarageRobotTombstone {
  if (entry.deleted) {
    return {
      type: "robot-tombstone",
      version: 1,
      id: entry.id,
      tokenId: entry.tokenId,
      revision: entry.revision,
      writerDeviceId: entry.deviceId,
      updatedAt: entry.updatedAt
    };
  }
  return {
    type: "robot",
    version: 1,
    id: entry.id,
    tokenId: entry.tokenId,
    nickname: entry.nickname,
    revision: entry.revision,
    writerDeviceId: entry.deviceId,
    updatedAt: entry.updatedAt
  };
}

export function syncRecordToRobotEntry(secret: Uint8Array, record: GarageRobotRecord | GarageRobotTombstone): GarageRobotEntry {
  if (record.type === "robot-tombstone") {
    return {
      id: record.id,
      tokenId: record.tokenId,
      nickname: "",
      revision: record.revision,
      deviceId: record.writerDeviceId,
      deleted: true,
      updatedAt: record.updatedAt
    };
  }
  const token = deriveGarageRobotToken(secret, record.id);
  if (garageTokenId(token) !== record.tokenId) throw new Error("Invalid synchronized robot identity.");
  return {
    id: record.id,
    tokenId: record.tokenId,
    nickname: record.nickname,
    revision: record.revision,
    deviceId: record.writerDeviceId,
    deleted: false,
    updatedAt: record.updatedAt
  };
}

export function presetToSyncRecord(preset: OfferPreset): GaragePresetRecord | GaragePresetTombstone {
  if (preset.deleted) {
    return {
      type: "preset-tombstone",
      version: 1,
      id: preset.id,
      revision: preset.revision,
      writerDeviceId: preset.deviceId,
      updatedAt: preset.updatedAt
    };
  }
  const { id: _id, revision, deviceId, deleted: _deleted, updatedAt, ...value } = preset;
  return {
    type: "preset",
    version: 1,
    id: preset.id,
    revision,
    writerDeviceId: deviceId,
    updatedAt,
    value
  };
}

export function preferencesToSyncRecord(settings: PortableSettingsManifest): GaragePreferencesRecord {
  return {
    type: "preferences",
    version: 1,
    id: "preferences",
    revision: settings.theme.revision,
    writerDeviceId: settings.theme.deviceId,
    updatedAt: settings.updatedAt,
    theme: settings.theme.value
  };
}

export function tradeHistoryToSyncRecord(entry: TradeHistoryEntry): GarageTradeHistoryRecord {
  const { id: _id, revision, deviceId, updatedAt, ...value } = entry;
  return {
    type: "trade-history",
    version: 1,
    id: entry.id,
    revision,
    writerDeviceId: deviceId,
    updatedAt,
    value
  };
}

export function syncRecordToTradeHistory(record: GarageTradeHistoryRecord): TradeHistoryEntry {
  return {
    ...record.value,
    id: record.id,
    revision: record.revision,
    deviceId: record.writerDeviceId,
    updatedAt: record.updatedAt
  };
}

export function syncRecordDomain(record: GarageSyncRecord): GarageKeyDomain {
  if (record.type === "trade-history") return "history-sync";
  return record.type === "robot" || record.type === "robot-tombstone" ? "garage-sync" : "settings-sync";
}

export function syncRecordKey(record: GarageSyncRecord): string {
  return `${syncRecordDomain(record)}:${record.type}:${record.id}`;
}

export function syncRecordAddress(secret: Uint8Array, record: GarageSyncRecord): string {
  const domain = syncRecordDomain(record);
  const key = deriveGarageDomainKey(secret, domain);
  const address = `robosats-exp:record:v3:${record.type}:${record.id}:${record.writerDeviceId}`;
  return bytesToHex(hmac(sha256, key, encoder.encode(address)));
}

export function compareSyncRecords(
  left: GarageSyncRecord,
  right: GarageSyncRecord,
  leftEventId = "",
  rightEventId = ""
): number {
  if (left.revision !== right.revision) return left.revision - right.revision;
  if (left.type.endsWith("tombstone") !== right.type.endsWith("tombstone")) {
    return left.type.endsWith("tombstone") ? 1 : -1;
  }
  const deviceOrder = left.writerDeviceId.localeCompare(right.writerDeviceId);
  return deviceOrder || leftEventId.localeCompare(rightEventId);
}

export function validateGarageSyncRecord(value: unknown): asserts value is GarageSyncRecord {
  if (!value || typeof value !== "object") throw new Error("Invalid synchronized record.");
  const record = value as Partial<GarageSyncRecord>;
  if (record.version !== 1 || !record.type || !record.id) throw new Error("Unsupported synchronized record.");
  const fields = new Set([
    "type", "version", "id", "revision", "writerDeviceId", "updatedAt",
    ...(record.type === "robot" ? ["tokenId", "nickname"] : []),
    ...(record.type === "robot-tombstone" ? ["tokenId"] : []),
    ...(record.type === "preset" ? ["value"] : []),
    ...(record.type === "preferences" ? ["theme"] : []),
    ...(record.type === "trade-history" ? ["value"] : [])
  ]);
  if (Object.keys(record).some((key) => !fields.has(key))) throw new Error("Synchronized record has unknown fields.");
  const opaqueId = record.type === "preferences" ? record.id === "preferences" : /^[0-9a-f]{32}$/.test(record.id);
  if (!opaqueId || !/^[0-9a-f]{32}$/.test(record.writerDeviceId ?? "")) throw new Error("Invalid synchronized record identity.");
  if (!Number.isSafeInteger(record.revision) || Number(record.revision) < 1) throw new Error("Invalid synchronized revision.");
  if (!Number.isSafeInteger(record.updatedAt) || Number(record.updatedAt) < 0) throw new Error("Invalid synchronized timestamp.");
  if (record.type === "robot" || record.type === "robot-tombstone") {
    if (!/^[0-9a-f]{64}$/.test(record.tokenId ?? "")) throw new Error("Invalid synchronized robot.");
    if (record.type === "robot") {
      if (typeof record.nickname !== "string" || record.nickname.length > 64) throw new Error("Invalid synchronized robot name.");
    }
  } else if (record.type === "preset") {
    if (!record.value || typeof record.value !== "object") throw new Error("Invalid synchronized preset.");
    validatePresetRecord(record as GaragePresetRecord);
  } else if (record.type === "preferences") {
    if (record.theme !== "dark" && record.theme !== "light") {
      throw new Error("Invalid synchronized theme.");
    }
  } else if (record.type === "trade-history") {
    if (!record.value || typeof record.value !== "object") throw new Error("Invalid synchronized trade history.");
    validateTradeHistoryEntry({
      ...record.value,
      id: record.id,
      revision: record.revision,
      deviceId: record.writerDeviceId,
      updatedAt: record.updatedAt
    });
  } else if (record.type !== "preset-tombstone") {
    throw new Error("Unsupported synchronized record.");
  }
  if (encoder.encode(JSON.stringify(record)).length > GARAGE_SYNC_LIMITS.plaintextBytes) {
    throw new Error("Synchronized record is too large.");
  }
}

function validatePresetRecord(record: GaragePresetRecord): void {
  validatePortableSettings({
    format: "robosats-exp-portable-settings",
    version: 2,
    deviceId: record.writerDeviceId,
    revision: record.revision,
    updatedAt: record.updatedAt,
    theme: { value: "dark", revision: 1, deviceId: record.writerDeviceId },
    presets: [{
      ...record.value,
      id: record.id,
      revision: record.revision,
      deviceId: record.writerDeviceId,
      deleted: false,
      updatedAt: record.updatedAt
    }]
  });
}
