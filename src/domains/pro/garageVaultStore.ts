import { create } from "zustand";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { readUiPreferences } from "@/domains/settings/uiPreferences";
import { systemClient } from "@/domains/transport/systemClient";
import { decryptGaragePayload, encryptGaragePayload } from "@/domains/pro/garageCrypto";
import { garageSecretStore } from "@/domains/pro/garageSecretStore";
import {
  activeGarageEntries,
  createGarageDeviceId,
  createGarageEntryId,
  createGarageManifest,
  createGarageSecret,
  decodeGarageToken,
  deriveGarageRobotToken,
  encodeGarageToken,
  FLEET_ROBOT_LIMIT_MESSAGE,
  garageTokenId,
  hasGarageRobotCapacity,
  mergeGarageManifests,
  removeGarageEntry,
  upsertGarageEntry,
  validateGarageManifest,
  validateGarageManifestForSecret,
  type GarageManifest,
  type GarageRobotEntry
} from "@/domains/pro/garageVault";
import {
  createPortableSettingsManifest,
  mergePortableSettings,
  validatePortableSettings,
  type OfferPreset,
  type PortableSettingsManifest
} from "@/domains/pro/portableSettings";
import {
  GARAGE_SYNC_LIMITS,
  compareSyncRecords,
  preferencesToSyncRecord,
  presetToSyncRecord,
  robotEntryToSyncRecord,
  syncRecordKey,
  syncRecordToRobotEntry,
  validateGarageSyncRecord,
  type GarageObservedEvent,
  type GarageOutboxItem,
  type GaragePresetRecord,
  type GaragePresetTombstone,
  type GarageSyncRecord,
  type ObservedGarageSyncRecord
} from "@/domains/pro/garageSyncRecords";

const DEVICE_ID_KEY = "robosats_exp_garage_device_v3";
const ENVELOPE_KEY = "robosats_exp_garage_envelope_v3";
const BACKUP_CONFIRMED_KEY = "robosats_exp_garage_backup_confirmed_v3";

export type GarageVaultStatus = "idle" | "loading" | "unconfigured" | "needs-backup" | "ready" | "error";
export type GarageSyncStatus = "idle" | "saving" | "up-to-date" | "offline";

export type GarageLocalEnvelope = {
  format: "robosats-exp-garage-envelope";
  version: 3;
  deviceId: string;
  revision: number;
  updatedAt: number;
  garage: GarageManifest;
  settings: PortableSettingsManifest;
  outbox: GarageOutboxItem[];
  observed: Record<string, GarageObservedEvent>;
};

export type GarageRecoverySnapshot = {
  format: "robosats-exp-garage-snapshot";
  version: 3;
  createdAt: number;
  garage: GarageManifest;
  settings: PortableSettingsManifest;
};

export type MaterializedGarageRobot = GarageRobotEntry & { token: string };

export type GaragePendingRecord = {
  item: GarageOutboxItem;
  record: GarageSyncRecord;
};

type GarageVaultState = {
  status: GarageVaultStatus;
  syncStatus: GarageSyncStatus;
  lastSyncAt?: number;
  lastPublicationAt?: number;
  envelope?: GarageLocalEnvelope;
  manifest?: GarageManifest;
  error?: string;
  initialize: () => Promise<void>;
  setup: () => Promise<string>;
  restore: (token: string, snapshot?: GarageRecoverySnapshot) => Promise<void>;
  abandon: () => Promise<void>;
  createDerivedRobot: (nickname?: string) => Promise<MaterializedGarageRobot>;
  removeRobot: (token: string) => Promise<void>;
  renameRobot: (token: string, nickname: string) => Promise<void>;
  exportToken: () => string;
  markBackedUp: () => void;
  replacePortableSettings: (settings: PortableSettingsManifest) => void;
  applyRemoteRecords: (records: ObservedGarageSyncRecord[]) => void;
  pendingOutbox: () => GaragePendingRecord[];
  recordOutboxAcknowledgements: (
    key: string,
    revision: number,
    relays: string[],
    observed: GarageObservedEvent
  ) => void;
  acknowledgeOutbox: (key: string, revision: number, observed: GarageObservedEvent) => void;
  deferOutbox: (key: string, revision: number, nextAttemptAt: number) => void;
  queueHeartbeat: () => void;
  setSyncState: (status: GarageSyncStatus, lastSyncAt?: number, error?: string, lastPublicationAt?: number) => void;
};

let garageSecret: Uint8Array | undefined;
let initialization: Promise<void> | undefined;

export const useGarageVaultStore = create<GarageVaultState>((set, get) => ({
  status: "idle",
  syncStatus: "idle",
  initialize: async () => {
    if (["ready", "needs-backup", "unconfigured"].includes(get().status)) return;
    if (initialization) return initialization;
    set({ status: "loading", error: undefined });
    initialization = (async () => {
      const storedToken = await garageSecretStore.load();
      if (!storedToken) {
        set({ status: "unconfigured", envelope: undefined, manifest: undefined });
        return;
      }
      garageSecret = decodeGarageToken(storedToken);
      const envelope = loadLocalEnvelope(garageSecret, currentDeviceId());
      setEnvelopeState(set, envelope, {
        status: systemClient.getItem(BACKUP_CONFIRMED_KEY) === "true" ? "ready" : "needs-backup"
      });
    })().catch((error) => {
      garageSecret = undefined;
      set({ status: "error", error: error instanceof Error ? error.message : "Could not open Fleet." });
    }).finally(() => { initialization = undefined; });
    return initialization;
  },
  setup: async () => {
    const previousState = get();
    const previousSecret = garageSecret?.slice();
    const previousToken = await garageSecretStore.load();
    const previousEnvelope = systemClient.getItem(ENVELOPE_KEY);
    const secret = createGarageSecret();
    const token = encodeGarageToken(secret);
    try {
      await garageSecretStore.save(token);
      systemClient.deleteItem(BACKUP_CONFIRMED_KEY);
      const envelope = createLocalEnvelope(currentDeviceId());
      persistEnvelope(secret, envelope);
      garageSecret = secret;
      setEnvelopeState(set, envelope, { status: "needs-backup", error: undefined, syncStatus: "idle" });
      return token;
    } catch (error) {
      await restoreStoredValue(previousToken);
      restoreSystemValue(ENVELOPE_KEY, previousEnvelope);
      garageSecret = previousSecret;
      set(previousState);
      throw error;
    }
  },
  restore: async (token, snapshot) => {
    const secret = decodeGarageToken(token);
    const encodedToken = encodeGarageToken(secret);
    const deviceId = currentDeviceId();
    const envelope = snapshot
      ? envelopeFromSnapshot(snapshot, deviceId)
      : createLocalEnvelope(deviceId);
    validateEnvelope(envelope, secret);
    const previousSecret = garageSecret?.slice();
    const previousToken = await garageSecretStore.load();
    const previousEnvelope = systemClient.getItem(ENVELOPE_KEY);
    try {
      await garageSecretStore.save(encodedToken);
      persistEnvelope(secret, envelope);
      systemClient.setItem(BACKUP_CONFIRMED_KEY, "true");
      garageSecret = secret;
      setEnvelopeState(set, envelope, { status: "ready", error: undefined, syncStatus: "idle" });
    } catch (error) {
      await restoreStoredValue(previousToken);
      restoreSystemValue(ENVELOPE_KEY, previousEnvelope);
      garageSecret = previousSecret;
      throw error;
    }
  },
  abandon: async () => {
    await garageSecretStore.remove();
    systemClient.deleteItem(ENVELOPE_KEY);
    systemClient.deleteItem(BACKUP_CONFIRMED_KEY);
    garageSecret = undefined;
    initialization = undefined;
    set({
      status: "unconfigured",
      syncStatus: "idle",
      lastSyncAt: undefined,
      lastPublicationAt: undefined,
      envelope: undefined,
      manifest: undefined,
      error: undefined
    });
  },
  createDerivedRobot: async (nickname = "Robot") => {
    if (!garageSecret || get().status !== "ready" || !get().envelope) throw new Error("Set up the Fleet before adding a robot.");
    if (!hasGarageRobotCapacity(get().envelope!.garage)) throw new Error(FLEET_ROBOT_LIMIT_MESSAGE);
    const id = createGarageEntryId();
    const token = deriveGarageRobotToken(garageSecret, id);
    const garage = upsertGarageEntry(get().envelope!.garage, { id, tokenId: garageTokenId(token), nickname });
    const entry = garage.entries.find((candidate) => candidate.id === id)!;
    commitEnvelope(queueRecord(updateEnvelope(get().envelope!, { garage }), robotEntryToSyncRecord(entry)), set);
    return { ...entry, token };
  },
  removeRobot: async (token) => {
    if (!garageSecret || get().status !== "ready" || !get().envelope) return;
    const entry = get().envelope!.garage.entries.find((candidate) => candidate.tokenId === garageTokenId(token));
    if (!entry || entry.deleted) return;
    const garage = removeGarageEntry(get().envelope!.garage, entry.id);
    const tombstone = garage.entries.find((candidate) => candidate.id === entry.id)!;
    commitEnvelope(queueRecord(updateEnvelope(get().envelope!, { garage }), robotEntryToSyncRecord(tombstone)), set);
  },
  renameRobot: async (token, nickname) => {
    if (!garageSecret || get().status !== "ready" || !get().envelope) return;
    const entry = get().envelope!.garage.entries.find((candidate) => candidate.tokenId === garageTokenId(token));
    if (!entry || entry.deleted || entry.nickname === nickname.trim()) return;
    const garage = upsertGarageEntry(get().envelope!.garage, {
      id: entry.id,
      tokenId: entry.tokenId,
      nickname
    });
    const nextEntry = garage.entries.find((candidate) => candidate.id === entry.id)!;
    commitEnvelope(queueRecord(updateEnvelope(get().envelope!, { garage }), robotEntryToSyncRecord(nextEntry)), set);
  },
  exportToken: () => {
    if (!garageSecret) throw new Error("Fleet is not set up.");
    return encodeGarageToken(garageSecret);
  },
  markBackedUp: () => {
    systemClient.setItem(BACKUP_CONFIRMED_KEY, "true");
    set({ status: "ready" });
  },
  replacePortableSettings: (settings) => {
    if (!garageSecret || !get().envelope) return;
    validatePortableSettings(settings);
    const current = get().envelope!.settings;
    if (JSON.stringify(current) === JSON.stringify(settings)) return;
    let envelope = updateEnvelope(get().envelope!, { settings });
    if (current.theme.value !== settings.theme.value || current.theme.revision !== settings.theme.revision) {
      envelope = queueRecord(envelope, preferencesToSyncRecord(settings));
    }
    for (const preset of settings.presets) {
      const previous = current.presets.find((candidate) => candidate.id === preset.id);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(preset)) envelope = queueRecord(envelope, presetToSyncRecord(preset));
    }
    commitEnvelope(envelope, set);
  },
  applyRemoteRecords: (records) => {
    if (!garageSecret || !get().envelope || records.length === 0) return;
    const next = mergeObservedRecords(get().envelope!, records, garageSecret);
    if (next === get().envelope) return;
    persistEnvelope(garageSecret, next);
    setEnvelopeState(set, next);
  },
  pendingOutbox: () => {
    const envelope = get().envelope;
    if (!envelope) return [];
    return envelope.outbox.flatMap((item) => {
      const record = recordForOutboxItem(envelope, item);
      return record ? [{ item, record }] : [];
    });
  },
  recordOutboxAcknowledgements: (key, revision, relays, observed) => {
    if (!garageSecret || !get().envelope || relays.length === 0) return;
    if (!get().envelope!.outbox.some((item) => item.key === key && item.revision === revision)) return;
    const outbox = get().envelope!.outbox.map((item) => {
      if (item.key !== key || item.revision !== revision) return item;
      const useObserved = observed.publishedAt >= (item.acceptedPublishedAt ?? 0);
      return {
        ...item,
        acceptedRelays: [...new Set([...item.acceptedRelays, ...relays])].sort(),
        acceptedEventId: useObserved ? observed.eventId : item.acceptedEventId,
        acceptedPublishedAt: useObserved ? observed.publishedAt : item.acceptedPublishedAt
      };
    });
    const next = updateEnvelope(get().envelope!, { outbox });
    persistEnvelope(garageSecret, next);
    setEnvelopeState(set, next);
  },
  acknowledgeOutbox: (key, revision, observed) => {
    if (!garageSecret || !get().envelope) return;
    const envelope = get().envelope!;
    const outbox = envelope.outbox.filter((item) => item.key !== key || item.revision !== revision);
    const next = updateEnvelope(envelope, { outbox, observed: { ...envelope.observed, [key]: observed } });
    persistEnvelope(garageSecret, next);
    setEnvelopeState(set, next);
  },
  deferOutbox: (key, revision, nextAttemptAt) => {
    if (!garageSecret || !get().envelope) return;
    if (!get().envelope!.outbox.some((item) => item.key === key && item.revision === revision)) return;
    const outbox = get().envelope!.outbox.map((item) => item.key === key && item.revision === revision
      ? { ...item, attempts: item.attempts + 1, nextAttemptAt }
      : item);
    const next = updateEnvelope(get().envelope!, { outbox });
    persistEnvelope(garageSecret, next);
    setEnvelopeState(set, next);
  },
  queueHeartbeat: () => {
    if (!garageSecret || !get().envelope) return;
    let envelope = get().envelope!;
    for (const entry of envelope.garage.entries) envelope = queueRecord(envelope, robotEntryToSyncRecord(entry));
    envelope = queueRecord(envelope, preferencesToSyncRecord(envelope.settings));
    for (const preset of envelope.settings.presets) envelope = queueRecord(envelope, presetToSyncRecord(preset));
    commitEnvelope(envelope, set);
  },
  setSyncState: (syncStatus, lastSyncAt, error, lastPublicationAt) => set((state) => ({
    syncStatus,
    lastSyncAt,
    error,
    lastPublicationAt: lastPublicationAt ?? state.lastPublicationAt
  }))
}));

export function getGarageSecret(): Uint8Array | undefined {
  return garageSecret?.slice();
}

export function resetGarageVaultRuntimeForTests(): void {
  garageSecret = undefined;
  initialization = undefined;
  useGarageVaultStore.setState({
    status: "idle",
    syncStatus: "idle",
    lastSyncAt: undefined,
    lastPublicationAt: undefined,
    envelope: undefined,
    manifest: undefined,
    error: undefined
  });
}

export function garageSlotsFromManifest(manifest: GarageManifest | undefined): MaterializedGarageRobot[] {
  if (!manifest || !garageSecret) return [];
  return activeGarageEntries(manifest).map((entry) => ({
    ...entry,
    token: deriveGarageRobotToken(garageSecret!, entry.id)
  }));
}

export function selectProGarageSlots(slots: RobotSlot[], manifest: GarageManifest | undefined): RobotSlot[] {
  if (!manifest) return [];
  const activeTokenIds = new Set(activeGarageEntries(manifest).map((entry) => entry.tokenId));
  return slots.filter((slot) => activeTokenIds.has(garageTokenId(slot.token)));
}

export function recoverySnapshotFromRecords(
  secret: Uint8Array,
  records: ObservedGarageSyncRecord[],
  deviceId = createGarageDeviceId()
): GarageRecoverySnapshot {
  if (records.length === 0) throw new Error("No Garage backup was found.");
  const envelope = mergeObservedRecords(createLocalEnvelope(deviceId), records, secret);
    return {
      format: "robosats-exp-garage-snapshot",
      version: 3,
    createdAt: Date.now(),
    garage: envelope.garage,
    settings: envelope.settings
  };
}

function createLocalEnvelope(deviceId: string, now = Date.now()): GarageLocalEnvelope {
  const ui = readUiPreferences();
  return {
    format: "robosats-exp-garage-envelope",
    version: 3,
    deviceId,
    revision: 0,
    updatedAt: now,
    garage: createGarageManifest(deviceId, now),
    settings: createPortableSettingsManifest(deviceId, { theme: ui.theme }, now),
    outbox: [],
    observed: {}
  };
}

function envelopeFromSnapshot(snapshot: GarageRecoverySnapshot, deviceId: string): GarageLocalEnvelope {
  validateRecoverySnapshot(snapshot);
  const garage = mergeGarageManifests([createGarageManifest(deviceId), snapshot.garage], deviceId);
  const settings = mergePortableSettings([
    createPortableSettingsManifest(deviceId, {
      theme: snapshot.settings.theme.value
    }),
    snapshot.settings
  ], deviceId);
  let envelope = updateEnvelope(createLocalEnvelope(deviceId), { garage, settings });
  for (const entry of garage.entries) envelope = queueRecord(envelope, robotEntryToSyncRecord(entry));
  envelope = queueRecord(envelope, preferencesToSyncRecord(settings));
  for (const preset of settings.presets) envelope = queueRecord(envelope, presetToSyncRecord(preset));
  return envelope;
}

function mergeObservedRecords(
  envelope: GarageLocalEnvelope,
  incoming: ObservedGarageSyncRecord[],
  secret: Uint8Array
): GarageLocalEnvelope {
  let garage = envelope.garage;
  let settings = envelope.settings;
  let changed = false;
  const observed = { ...envelope.observed };
  let outbox = envelope.outbox;
  for (const item of incoming) {
    validateGarageSyncRecord(item.record);
    const key = syncRecordKey(item.record);
    const previousObserved = observed[key];
    if (previousObserved && compareObserved(item, previousObserved) <= 0) {
      if (item.publishedAt > previousObserved.publishedAt) {
        observed[key] = { ...previousObserved, publishedAt: item.publishedAt };
        const currentRecord = currentRecordForKey({ ...envelope, garage, settings }, key);
        if (currentRecord && compareSyncRecords(currentRecord, item.record) > 0) {
          outbox = queueOutboxItem(outbox, currentRecord);
        }
      }
      continue;
    }
    if (item.record.type === "robot" || item.record.type === "robot-tombstone") {
      const entry = syncRecordToRobotEntry(secret, item.record);
      const existing = garage.entries.find((candidate) => candidate.id === entry.id);
      const mayApply = !existing
        || (!existing.deleted && entry.deleted)
        || (!existing.deleted && !entry.deleted
          && compareRobotEntries(entry, existing, item.eventId, observed[syncRecordKey(robotEntryToSyncRecord(existing))]?.eventId) > 0)
        || (existing.deleted && entry.deleted
          && compareRobotEntries(entry, existing, item.eventId, observed[syncRecordKey(robotEntryToSyncRecord(existing))]?.eventId) > 0);
      if (mayApply) {
        garage = entry.deleted
          ? forceGarageEntry(garage, entry)
          : mergeGarageManifests([garage, singleEntryManifest(entry)], garage.deviceId);
        changed = true;
      } else if (existing) {
        outbox = queueOutboxItem(outbox, robotEntryToSyncRecord(existing));
      }
    } else {
      if (item.record.type === "preset" && settings.presets.some((preset) => preset.id === item.record.id && preset.deleted)) {
        observed[key] = {
          eventId: item.eventId,
          publishedAt: item.publishedAt,
          revision: item.record.revision,
          writerDeviceId: item.record.writerDeviceId
        };
        continue;
      }
      const remoteSettings = settingsFromRecord(settings, item.record);
      const merged = item.record.type === "preset-tombstone"
        ? forcePreset(settings, remoteSettings.presets[0])
        : mergePortableSettings([settings, remoteSettings], settings.deviceId);
      if (JSON.stringify(merged) !== JSON.stringify(settings)) {
        settings = merged;
        changed = true;
      } else {
        const currentRecord = currentSettingsRecord(settings, item.record);
        if (currentRecord && compareSyncRecords(currentRecord, item.record) > 0) {
          outbox = queueOutboxItem(outbox, currentRecord);
        }
      }
    }
    observed[key] = {
      eventId: item.eventId,
      publishedAt: item.publishedAt,
      revision: item.record.revision,
      writerDeviceId: item.record.writerDeviceId
    };
    outbox = outbox.filter((pending) => {
      if (pending.key !== key) return true;
      const pendingRecord = recordForOutboxItem(envelope, pending);
      return Boolean(pendingRecord && compareSyncRecords(pendingRecord, item.record) >= 0);
    });
  }
  if (!changed && outbox === envelope.outbox && JSON.stringify(observed) === JSON.stringify(envelope.observed)) return envelope;
  return updateEnvelope(envelope, { garage, settings, outbox, observed });
}

function settingsFromRecord(current: PortableSettingsManifest, record: GarageSyncRecord): PortableSettingsManifest {
  if (record.type === "preferences") {
    return {
      ...createPortableSettingsManifest(record.writerDeviceId, { theme: record.theme }, record.updatedAt),
      revision: record.revision,
      theme: { value: record.theme, revision: record.revision, deviceId: record.writerDeviceId }
    };
  }
  if (record.type !== "preset" && record.type !== "preset-tombstone") return current;
  const preset = syncRecordToPreset(record);
  return {
    ...createPortableSettingsManifest(record.writerDeviceId, {
      theme: current.theme.value
    }, record.updatedAt),
    revision: record.revision,
    theme: current.theme,
    presets: [preset]
  };
}

function syncRecordToPreset(record: GaragePresetRecord | GaragePresetTombstone): OfferPreset {
  if (record.type === "preset-tombstone") {
    return {
      id: record.id,
      name: "",
      direction: 0,
      isSwap: false,
      currency: "",
      paymentMethods: [],
      premium: 0,
      bond: 1,
      publicDuration: 1,
      escrowDuration: 1,
      description: "",
      password: "",
      revision: record.revision,
      deviceId: record.writerDeviceId,
      deleted: true,
      updatedAt: record.updatedAt
    };
  }
  return {
    ...record.value,
    id: record.id,
    revision: record.revision,
    deviceId: record.writerDeviceId,
    deleted: false,
    updatedAt: record.updatedAt
  };
}

function singleEntryManifest(entry: GarageRobotEntry): GarageManifest {
  return {
    format: "robosats-exp-garage",
    version: 1,
    deviceId: entry.deviceId,
    revision: entry.revision,
    updatedAt: entry.updatedAt,
    entries: [entry]
  };
}

function forceGarageEntry(manifest: GarageManifest, entry: GarageRobotEntry): GarageManifest {
  const next: GarageManifest = {
    ...manifest,
    revision: Math.max(manifest.revision, entry.revision) + 1,
    updatedAt: Math.max(manifest.updatedAt, entry.updatedAt),
    entries: [...manifest.entries.filter((candidate) => candidate.id !== entry.id && candidate.tokenId !== entry.tokenId), entry]
      .sort((left, right) => left.id.localeCompare(right.id))
  };
  validateGarageManifest(next);
  return next;
}

function forcePreset(settings: PortableSettingsManifest, preset: OfferPreset): PortableSettingsManifest {
  const next: PortableSettingsManifest = {
    ...settings,
    revision: Math.max(settings.revision, preset.revision) + 1,
    updatedAt: Math.max(settings.updatedAt, preset.updatedAt),
    presets: [...settings.presets.filter((candidate) => candidate.id !== preset.id), preset]
      .sort((left, right) => left.id.localeCompare(right.id))
  };
  validatePortableSettings(next);
  return next;
}

function compareRobotEntries(left: GarageRobotEntry, right: GarageRobotEntry, leftEventId = "", rightEventId = ""): number {
  return compareSyncRecords(robotEntryToSyncRecord(left), robotEntryToSyncRecord(right), leftEventId, rightEventId);
}

function compareObserved(incoming: ObservedGarageSyncRecord, current: GarageObservedEvent): number {
  if (incoming.record.revision !== current.revision) return incoming.record.revision - current.revision;
  const writerOrder = incoming.record.writerDeviceId.localeCompare(current.writerDeviceId);
  return writerOrder || incoming.eventId.localeCompare(current.eventId);
}

function queueRecord(envelope: GarageLocalEnvelope, record: GarageSyncRecord, now = Date.now()): GarageLocalEnvelope {
  validateGarageSyncRecord(record);
  const outbox = queueOutboxItem(envelope.outbox, record, now);
  if (outbox.length > GARAGE_SYNC_LIMITS.outbox) throw new Error("Too many pending Garage changes.");
  return updateEnvelope(envelope, { outbox });
}

function queueOutboxItem(outbox: GarageOutboxItem[], record: GarageSyncRecord, now = Date.now()): GarageOutboxItem[] {
  const key = syncRecordKey(record);
  const current = outbox.find((item) => item.key === key && item.revision === record.revision);
  if (current) {
    return outbox.map((item) => item === current
      ? { ...item, nextAttemptAt: Math.min(item.nextAttemptAt, now) }
      : item);
  }
  return [...outbox.filter((item) => item.key !== key), {
    key,
    revision: record.revision,
    queuedAt: now,
    attempts: 0,
    nextAttemptAt: now,
    acceptedRelays: []
  }].sort((left, right) => left.queuedAt - right.queuedAt);
}

function currentSettingsRecord(settings: PortableSettingsManifest, incoming: GarageSyncRecord): GarageSyncRecord | undefined {
  if (incoming.type === "preferences") return preferencesToSyncRecord(settings);
  if (incoming.type === "preset" || incoming.type === "preset-tombstone") {
    const preset = settings.presets.find((candidate) => candidate.id === incoming.id);
    return preset ? presetToSyncRecord(preset) : undefined;
  }
  return undefined;
}

function updateEnvelope(
  envelope: GarageLocalEnvelope,
  values: Partial<Pick<GarageLocalEnvelope, "garage" | "settings" | "outbox" | "observed">>,
  now = Date.now()
): GarageLocalEnvelope {
  const next = { ...envelope, ...values, revision: envelope.revision + 1, updatedAt: now };
  next.outbox = next.outbox.filter((item) => Boolean(recordForOutboxItem(next, item)));
  return next;
}

function loadLocalEnvelope(secret: Uint8Array, deviceId: string): GarageLocalEnvelope {
  const ciphertext = systemClient.getItem(ENVELOPE_KEY);
  if (ciphertext) {
    try {
      const parsed = JSON.parse(decryptGaragePayload(secret, "local", ciphertext)) as unknown;
      validateEnvelope(parsed, secret);
      return parsed;
    } catch {
      systemClient.deleteItem(ENVELOPE_KEY);
    }
  }
  const envelope = createLocalEnvelope(deviceId);
  persistEnvelope(secret, envelope);
  return envelope;
}

function commitEnvelope(
  envelope: GarageLocalEnvelope,
  set: (value: Partial<GarageVaultState>) => void
): void {
  if (!garageSecret) throw new Error("Fleet is not set up.");
  persistEnvelope(garageSecret, envelope);
  setEnvelopeState(set, envelope, { syncStatus: "idle" });
}

function setEnvelopeState(
  set: (value: Partial<GarageVaultState>) => void,
  envelope: GarageLocalEnvelope,
  extra: Partial<GarageVaultState> = {}
): void {
  set({
    envelope,
    manifest: envelope.garage,
    ...extra
  });
}

function persistEnvelope(secret: Uint8Array, envelope: GarageLocalEnvelope): void {
  validateEnvelope(envelope, secret);
  systemClient.setItem(ENVELOPE_KEY, encryptGaragePayload(secret, "local", JSON.stringify(envelope)));
}

function validateEnvelope(value: unknown, secret: Uint8Array): asserts value is GarageLocalEnvelope {
  if (!value || typeof value !== "object") throw new Error("Invalid Garage envelope.");
  const envelope = value as Partial<GarageLocalEnvelope>;
  const fields = new Set(["format", "version", "deviceId", "revision", "updatedAt", "garage", "settings", "outbox", "observed"]);
  if (Object.keys(envelope).some((key) => !fields.has(key))) throw new Error("Garage envelope has unknown fields.");
  if (envelope.format !== "robosats-exp-garage-envelope" || envelope.version !== 3) throw new Error("Unsupported Garage envelope.");
  if (!/^[0-9a-f]{32}$/.test(envelope.deviceId ?? "")) throw new Error("Invalid Garage device.");
  if (!Number.isSafeInteger(envelope.revision) || Number(envelope.revision) < 0) throw new Error("Invalid Garage envelope revision.");
  validateGarageManifestForSecret(envelope.garage, secret);
  validatePortableSettings(envelope.settings);
  if (!Array.isArray(envelope.outbox) || envelope.outbox.length > GARAGE_SYNC_LIMITS.outbox) throw new Error("Invalid Garage outbox.");
  for (const item of envelope.outbox) {
    if (typeof item.key !== "string" || !Number.isSafeInteger(item.revision) || item.revision < 1
      || !Number.isSafeInteger(item.queuedAt) || item.queuedAt < 0
      || !Number.isSafeInteger(item.attempts) || item.attempts < 0
      || !Number.isSafeInteger(item.nextAttemptAt) || item.nextAttemptAt < 0
      || !Array.isArray(item.acceptedRelays)
      || item.acceptedRelays.length > 32
      || item.acceptedRelays.some((relay) => typeof relay !== "string" || !/^wss?:\/\//.test(relay))
      || new Set(item.acceptedRelays).size !== item.acceptedRelays.length
      || (item.acceptedEventId !== undefined && !/^[0-9a-f]{64}$/.test(item.acceptedEventId))
      || (item.acceptedPublishedAt !== undefined
        && (!Number.isSafeInteger(item.acceptedPublishedAt) || item.acceptedPublishedAt < 0))) {
      throw new Error("Invalid Garage outbox item.");
    }
    if (item.acceptedRelays.length > 0 && item.acceptedEventId === undefined) {
      throw new Error("Invalid Garage outbox acknowledgement.");
    }
    if ((item.acceptedEventId === undefined) !== (item.acceptedPublishedAt === undefined)) {
      throw new Error("Invalid Garage outbox acknowledgement.");
    }
    if (!recordForOutboxItem(envelope as GarageLocalEnvelope, item)) throw new Error("Garage outbox record is missing.");
  }
  if (!envelope.observed || typeof envelope.observed !== "object") throw new Error("Invalid Garage observations.");
}

function validateRecoverySnapshot(value: unknown): asserts value is GarageRecoverySnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid Garage snapshot.");
  const snapshot = value as Partial<GarageRecoverySnapshot>;
  const fields = new Set(["format", "version", "createdAt", "garage", "settings"]);
  if (Object.keys(snapshot).some((key) => !fields.has(key))) throw new Error("Garage snapshot has unknown fields.");
  if (snapshot.format !== "robosats-exp-garage-snapshot" || snapshot.version !== 3) throw new Error("Unsupported Garage snapshot.");
  validateGarageManifest(snapshot.garage);
  validatePortableSettings(snapshot.settings);
}

function currentDeviceId(): string {
  const stored = systemClient.getItem(DEVICE_ID_KEY);
  if (stored && /^[0-9a-f]{32}$/.test(stored)) return stored;
  const deviceId = createGarageDeviceId();
  systemClient.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

async function restoreStoredValue(value: string | null): Promise<void> {
  if (value === null) await garageSecretStore.remove();
  else await garageSecretStore.save(value);
}

function restoreSystemValue(key: string, value: string | null): void {
  if (value === null) systemClient.deleteItem(key);
  else systemClient.setItem(key, value);
}

function recordForOutboxItem(envelope: GarageLocalEnvelope, item: GarageOutboxItem): GarageSyncRecord | undefined {
  const records: GarageSyncRecord[] = [
    ...envelope.garage.entries.map(robotEntryToSyncRecord),
    preferencesToSyncRecord(envelope.settings),
    ...envelope.settings.presets.map(presetToSyncRecord)
  ];
  return records.find((record) => syncRecordKey(record) === item.key && record.revision === item.revision);
}

function currentRecordForKey(envelope: GarageLocalEnvelope, key: string): GarageSyncRecord | undefined {
  return [
    ...envelope.garage.entries.map(robotEntryToSyncRecord),
    preferencesToSyncRecord(envelope.settings),
    ...envelope.settings.presets.map(presetToSyncRecord)
  ].find((record) => syncRecordKey(record) === key);
}
