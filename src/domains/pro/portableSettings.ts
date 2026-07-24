import { createGarageEntryId } from "@/domains/pro/garageVault";

export const PORTABLE_SETTINGS_LIMITS = {
  devices: 32,
  methodsPerPreset: 16,
  plaintextBytes: 40 * 1024,
  presets: 128,
  textLength: 64,
  descriptionLength: 500,
  passwordLength: 128
} as const;

export type PortableValue<T> = {
  value: T;
  revision: number;
  deviceId: string;
};

export type OfferPreset = {
  id: string;
  name: string;
  direction: 0 | 1;
  isSwap: boolean;
  currency: string;
  amount?: string;
  minAmount?: string;
  maxAmount?: string;
  paymentMethods: string[];
  premium: number;
  bond: number;
  publicDuration: number;
  escrowDuration: number;
  description: string;
  password: string;
  revision: number;
  deviceId: string;
  deleted: boolean;
  updatedAt: number;
};

export type PortableSettingsManifest = {
  format: "robosats-exp-portable-settings";
  version: 2;
  deviceId: string;
  revision: number;
  updatedAt: number;
  theme: PortableValue<"dark" | "light">;
  presets: OfferPreset[];
};

export type OfferPresetInput = Omit<
  OfferPreset,
  "id" | "revision" | "deviceId" | "deleted" | "updatedAt"
> & { id?: string };

export function createPortableSettingsManifest(
  deviceId: string,
  preferences: { theme: "dark" | "light" },
  now = Date.now()
): PortableSettingsManifest {
  return {
    format: "robosats-exp-portable-settings",
    version: 2,
    deviceId,
    revision: 0,
    updatedAt: now,
    theme: { value: preferences.theme, revision: 1, deviceId },
    presets: []
  };
}

export function updatePortablePreferences(
  manifest: PortableSettingsManifest,
  preferences: Partial<{ theme: "dark" | "light" }>,
  now = Date.now()
): PortableSettingsManifest {
  validatePortableSettings(manifest);
  let changed = false;
  const next = { ...manifest };
  if (preferences.theme && preferences.theme !== manifest.theme.value) {
    next.theme = { value: preferences.theme, revision: manifest.theme.revision + 1, deviceId: manifest.deviceId };
    changed = true;
  }
  if (!changed) return manifest;
  next.revision += 1;
  next.updatedAt = now;
  return next;
}

export function saveOfferPreset(
  manifest: PortableSettingsManifest,
  input: OfferPresetInput,
  now = Date.now()
): PortableSettingsManifest {
  validatePortableSettings(manifest);
  const id = input.id ?? createGarageEntryId();
  const existing = manifest.presets.find((preset) => preset.id === id);
  const preset: OfferPreset = {
    ...input,
    id,
    name: cleanText(input.name),
    direction: input.direction,
    isSwap: input.isSwap,
    currency: cleanText(input.currency).toUpperCase(),
    paymentMethods: input.paymentMethods.map(cleanText).filter(Boolean).slice(0, PORTABLE_SETTINGS_LIMITS.methodsPerPreset),
    premium: finiteNumber(input.premium),
    bond: finiteNumber(input.bond),
    publicDuration: positiveInteger(input.publicDuration),
    escrowDuration: positiveInteger(input.escrowDuration),
    description: cleanLongText(input.description, PORTABLE_SETTINGS_LIMITS.descriptionLength),
    password: cleanLongText(input.password, PORTABLE_SETTINGS_LIMITS.passwordLength),
    revision: (existing?.revision ?? 0) + 1,
    deviceId: manifest.deviceId,
    deleted: false,
    updatedAt: now
  };
  return replacePreset(manifest, preset, now);
}

export function removeOfferPreset(manifest: PortableSettingsManifest, id: string, now = Date.now()): PortableSettingsManifest {
  const existing = manifest.presets.find((preset) => preset.id === id);
  if (!existing) return manifest;
  return replacePreset(manifest, {
    ...existing,
    name: "",
    paymentMethods: [],
    revision: existing.revision + 1,
    deviceId: manifest.deviceId,
    deleted: true,
    updatedAt: now
  }, now);
}

export function mergePortableSettings(
  manifests: PortableSettingsManifest[],
  deviceId: string,
  now = Date.now()
): PortableSettingsManifest {
  if (manifests.length === 0) throw new Error("No portable settings to merge.");
  if (manifests.length > PORTABLE_SETTINGS_LIMITS.devices) throw new Error("Too many settings devices.");
  manifests.forEach(validatePortableSettings);
  const presets = new Map<string, OfferPreset>();
  let revision = 0;
  let theme = manifests[0].theme;
  for (const manifest of manifests) {
    revision = Math.max(revision, manifest.revision);
    if (compareRecords(manifest.theme, theme) > 0) theme = manifest.theme;
    for (const candidate of manifest.presets) {
      const current = presets.get(candidate.id);
      if (!current || comparePresets(candidate, current) > 0) presets.set(candidate.id, candidate);
    }
  }
  const sortedPresets = [...presets.values()].sort((left, right) => left.id.localeCompare(right.id));
  const local = manifests.find((manifest) => manifest.deviceId === deviceId);
  if (local
    && sameRecord(local.theme, theme)
    && JSON.stringify(local.presets) === JSON.stringify(sortedPresets)) return local;

  const merged: PortableSettingsManifest = {
    format: "robosats-exp-portable-settings",
    version: 2,
    deviceId,
    revision: revision + 1,
    updatedAt: now,
    theme,
    presets: sortedPresets
  };
  validatePortableSettings(merged);
  return merged;
}

export function validatePortableSettings(value: unknown): asserts value is PortableSettingsManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid portable settings.");
  const manifest = value as Partial<PortableSettingsManifest>;
  if (manifest.format !== "robosats-exp-portable-settings" || manifest.version !== 2) {
    throw new Error("Unsupported portable settings.");
  }
  if (!/^[0-9a-f]{32}$/.test(manifest.deviceId ?? "")) throw new Error("Invalid settings device.");
  if (!Number.isSafeInteger(manifest.revision) || Number(manifest.revision) < 0) throw new Error("Invalid settings revision.");
  if (!Number.isSafeInteger(manifest.updatedAt) || Number(manifest.updatedAt) < 0) throw new Error("Invalid settings timestamp.");
  validateRecord(manifest.theme, (item) => item === "dark" || item === "light");
  if (!Array.isArray(manifest.presets) || manifest.presets.length > PORTABLE_SETTINGS_LIMITS.presets) {
    throw new Error("Offer preset limit exceeded.");
  }
  const ids = new Set<string>();
  for (const preset of manifest.presets) {
    if (!/^[0-9a-f]{32}$/.test(preset.id) || !/^[0-9a-f]{32}$/.test(preset.deviceId)) throw new Error("Invalid preset ID.");
    if (ids.has(preset.id)) throw new Error("Duplicate offer preset.");
    ids.add(preset.id);
    if (!Number.isSafeInteger(preset.revision) || preset.revision < 1) throw new Error("Invalid preset revision.");
    if (!Number.isSafeInteger(preset.updatedAt) || preset.updatedAt < 0) throw new Error("Invalid preset timestamp.");
    if (preset.name.length > PORTABLE_SETTINGS_LIMITS.textLength || preset.currency.length > 16) throw new Error("Preset text is too long.");
    if (preset.paymentMethods.length > PORTABLE_SETTINGS_LIMITS.methodsPerPreset) throw new Error("Too many payment methods.");
    if (preset.paymentMethods.some((method) => typeof method !== "string" || method.length > PORTABLE_SETTINGS_LIMITS.textLength)) {
      throw new Error("Invalid payment method.");
    }
    if (preset.deleted) {
      if (preset.name !== "" || preset.paymentMethods.length !== 0) throw new Error("Invalid preset tombstone.");
      continue;
    }
    if (preset.direction !== 0 && preset.direction !== 1) throw new Error("Invalid preset direction.");
    if (typeof preset.isSwap !== "boolean") throw new Error("Invalid preset trade type.");
    if (!preset.name || !preset.currency) throw new Error("Incomplete offer preset.");
    if (typeof preset.description !== "string" || preset.description.length > PORTABLE_SETTINGS_LIMITS.descriptionLength) {
      throw new Error("Invalid preset description.");
    }
    if (typeof preset.password !== "string" || preset.password.length > PORTABLE_SETTINGS_LIMITS.passwordLength) {
      throw new Error("Invalid preset password.");
    }
    if (![preset.amount, preset.minAmount, preset.maxAmount].every((amount) => amount === undefined || /^\d+(?:\.\d+)?$/.test(amount))) {
      throw new Error("Invalid preset amount.");
    }
    const hasAmount = preset.amount !== undefined;
    const hasRange = preset.minAmount !== undefined && preset.maxAmount !== undefined;
    if (hasAmount === hasRange || (preset.minAmount === undefined) !== (preset.maxAmount === undefined)) {
      throw new Error("Incomplete preset amount.");
    }
    finiteNumber(preset.premium);
    finiteNumber(preset.bond);
    positiveInteger(preset.publicDuration);
    positiveInteger(preset.escrowDuration);
  }
  if (new TextEncoder().encode(JSON.stringify(manifest)).length > PORTABLE_SETTINGS_LIMITS.plaintextBytes) {
    throw new Error("Portable settings are too large.");
  }
}

export function activeOfferPresets(manifest: PortableSettingsManifest | undefined): OfferPreset[] {
  return manifest?.presets.filter((preset) => !preset.deleted) ?? [];
}

function replacePreset(manifest: PortableSettingsManifest, preset: OfferPreset, now: number): PortableSettingsManifest {
  const next = {
    ...manifest,
    revision: manifest.revision + 1,
    updatedAt: now,
    presets: [...manifest.presets.filter((candidate) => candidate.id !== preset.id), preset]
      .sort((left, right) => left.id.localeCompare(right.id))
  };
  validatePortableSettings(next);
  return next;
}

function compareRecords<T>(left: PortableValue<T>, right: PortableValue<T>): number {
  return left.revision - right.revision || left.deviceId.localeCompare(right.deviceId);
}

function comparePresets(left: OfferPreset, right: OfferPreset): number {
  return left.revision - right.revision
    || Number(left.deleted) - Number(right.deleted)
    || left.deviceId.localeCompare(right.deviceId);
}

function sameRecord<T>(left: PortableValue<T>, right: PortableValue<T>): boolean {
  return left.value === right.value && left.revision === right.revision && left.deviceId === right.deviceId;
}

function validateRecord<T>(record: PortableValue<T> | undefined, validValue: (value: unknown) => boolean): void {
  if (!record || !validValue(record.value) || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !/^[0-9a-f]{32}$/.test(record.deviceId)) throw new Error("Invalid portable preference.");
}

function cleanText(value: string): string {
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, PORTABLE_SETTINGS_LIMITS.textLength);
}

function cleanLongText(value: string, limit: number): string {
  return value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, limit);
}

function finiteNumber(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Invalid preset number.");
  return value;
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid preset duration.");
  return value;
}
