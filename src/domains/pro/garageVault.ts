import { bech32m } from "@scure/base";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey } from "nostr-tools/pure";
import { validateTokenEntropy } from "@/domains/garage/token";

const GARAGE_HRP = "rsgarage";
const GARAGE_TOKEN_VERSION = 1;
const ROBOT_TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ROBOT_TOKEN_LENGTH = 36;
const DERIVATION_SALT = new TextEncoder().encode("robosats-exp:garage:v1");

export const GARAGE_LIMITS = {
  activeRobots: 6,
  devices: 32,
  plaintextBytes: 40 * 1024,
  presets: 128,
  robots: 128
} as const;

export const FLEET_ROBOT_LIMIT_MESSAGE =
  `A Fleet can hold up to ${GARAGE_LIMITS.activeRobots} robots. Remove an idle robot before adding another.`;

export type GarageRobotEntry = {
  id: string;
  tokenId: string;
  nickname: string;
  revision: number;
  deviceId: string;
  deleted: boolean;
  updatedAt: number;
};

export type GarageManifest = {
  format: "robosats-exp-garage";
  version: 1;
  deviceId: string;
  revision: number;
  updatedAt: number;
  entries: GarageRobotEntry[];
};

export function createGarageSecret(): Uint8Array {
  return generateSecretKey();
}

export function encodeGarageToken(secret: Uint8Array): string {
  assertGarageSecret(secret);
  const payload = new Uint8Array(1 + secret.length);
  payload[0] = GARAGE_TOKEN_VERSION;
  payload.set(secret, 1);
  return bech32m.encodeFromBytes(GARAGE_HRP, payload);
}

export function decodeGarageToken(token: string): Uint8Array {
  const normalized = token.trim();
  if (normalized !== normalized.toLowerCase() && normalized !== normalized.toUpperCase()) {
    throw new Error("Invalid Fleet key.");
  }
  let decoded: { prefix: string; bytes: Uint8Array };
  try {
    decoded = bech32m.decodeToBytes(normalized.toLowerCase());
  } catch {
    throw new Error("Invalid Fleet key.");
  }
  if (decoded.prefix !== GARAGE_HRP || decoded.bytes.length !== 33 || decoded.bytes[0] !== GARAGE_TOKEN_VERSION) {
    throw new Error("Unsupported Fleet key.");
  }
  const secret = decoded.bytes.slice(1);
  assertGarageSecret(secret);
  return secret;
}

export function createGarageEntryId(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

export function createGarageDeviceId(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

export function deriveGarageRobotToken(secret: Uint8Array, entryId: string): string {
  assertGarageSecret(secret);
  assertOpaqueId(entryId, "robot entry");
  const accepted: string[] = [];
  let counter = 0;
  while (accepted.length < ROBOT_TOKEN_LENGTH) {
    const info = new TextEncoder().encode(`robosats-exp:robot-token:v1:${entryId}:${counter}`);
    const block = hkdf(sha256, secret, DERIVATION_SALT, info, 64);
    for (const byte of block) {
      if (byte >= 248) continue;
      accepted.push(ROBOT_TOKEN_ALPHABET[byte % ROBOT_TOKEN_ALPHABET.length]);
      if (accepted.length === ROBOT_TOKEN_LENGTH) break;
    }
    counter += 1;
  }
  const token = accepted.join("");
  if (!validateTokenEntropy(token).hasEnoughEntropy) throw new Error("Could not derive a valid robot token.");
  return token;
}

export function garageTokenId(token: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}

export function createGarageManifest(deviceId: string, now = Date.now()): GarageManifest {
  assertOpaqueId(deviceId, "device");
  return {
    format: "robosats-exp-garage",
    version: 1,
    deviceId: deviceId.toLowerCase(),
    revision: 0,
    updatedAt: now,
    entries: []
  };
}

export function upsertGarageEntry(
  manifest: GarageManifest,
  input: Pick<GarageRobotEntry, "id" | "tokenId" | "nickname">,
  now = Date.now()
): GarageManifest {
  validateGarageManifest(manifest);
  assertOpaqueId(input.id, "robot entry");
  if (!/^[0-9a-f]{64}$/.test(input.tokenId)) throw new Error("Invalid robot identity.");
  const existing = manifest.entries.find((entry) => entry.id === input.id);
  const revision = (existing?.revision ?? 0) + 1;
  const entry: GarageRobotEntry = {
    id: input.id.toLowerCase(),
    tokenId: input.tokenId,
    nickname: cleanNickname(input.nickname),
    revision,
    deviceId: manifest.deviceId,
    deleted: false,
    updatedAt: now
  };
  return replaceEntry(manifest, entry, now);
}

export function removeGarageEntry(manifest: GarageManifest, entryId: string, now = Date.now()): GarageManifest {
  validateGarageManifest(manifest);
  const existing = manifest.entries.find((entry) => entry.id === entryId);
  if (!existing) return manifest;
  return replaceEntry(manifest, {
    ...existing,
    nickname: "",
    revision: existing.revision + 1,
    deviceId: manifest.deviceId,
    deleted: true,
    updatedAt: now
  }, now);
}

export function mergeGarageManifests(manifests: GarageManifest[], deviceId: string, now = Date.now()): GarageManifest {
  assertOpaqueId(deviceId, "device");
  if (manifests.length > GARAGE_LIMITS.devices) throw new Error("Too many Garage devices.");
  const entries = new Map<string, GarageRobotEntry>();
  let revision = 0;
  for (const manifest of manifests) {
    validateGarageManifest(manifest);
    revision = Math.max(revision, manifest.revision);
    for (const candidate of manifest.entries) {
      const current = entries.get(candidate.id);
      if (!current || compareGarageEntries(candidate, current) > 0) entries.set(candidate.id, candidate);
    }
  }
  const byToken = new Map<string, GarageRobotEntry>();
  for (const candidate of entries.values()) {
    const current = byToken.get(candidate.tokenId);
    if (!current || compareGarageEntries(candidate, current) > 0) byToken.set(candidate.tokenId, candidate);
  }
  const sortedEntries = [...byToken.values()].sort((left, right) => left.id.localeCompare(right.id));
  const local = manifests.find((manifest) => manifest.deviceId === deviceId.toLowerCase());
  if (local && JSON.stringify(local.entries) === JSON.stringify(sortedEntries)) return local;
  const merged: GarageManifest = {
    format: "robosats-exp-garage",
    version: 1,
    deviceId: deviceId.toLowerCase(),
    revision: revision + 1,
    updatedAt: now,
    entries: sortedEntries
  };
  validateGarageManifest(merged);
  return merged;
}

export function activeGarageEntries(manifest: GarageManifest): GarageRobotEntry[] {
  return manifest.entries.filter((entry) => !entry.deleted);
}

export function hasGarageRobotCapacity(manifest: GarageManifest): boolean {
  validateGarageManifest(manifest);
  return activeGarageEntries(manifest).length < GARAGE_LIMITS.activeRobots;
}

export function validateGarageManifest(value: unknown): asserts value is GarageManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid Garage data.");
  const manifest = value as Partial<GarageManifest>;
  const fields = new Set(["format", "version", "deviceId", "revision", "updatedAt", "entries"]);
  if (Object.keys(manifest).some((key) => !fields.has(key))) throw new Error("Garage data has unknown fields.");
  if (manifest.format !== "robosats-exp-garage" || manifest.version !== 1) throw new Error("Unsupported Garage data.");
  if (!manifest.deviceId) throw new Error("Garage device is missing.");
  assertOpaqueId(manifest.deviceId, "device");
  if (!Number.isSafeInteger(manifest.revision) || Number(manifest.revision) < 0) throw new Error("Invalid Garage revision.");
  if (!Number.isSafeInteger(manifest.updatedAt) || Number(manifest.updatedAt) < 0) throw new Error("Invalid Garage timestamp.");
  if (!Array.isArray(manifest.entries) || manifest.entries.length > GARAGE_LIMITS.robots) {
    throw new Error("Garage robot limit exceeded.");
  }
  const ids = new Set<string>();
  const tokenIds = new Set<string>();
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== "object") throw new Error("Invalid Garage robot.");
    const fields = new Set(["id", "tokenId", "nickname", "revision", "deviceId", "deleted", "updatedAt"]);
    if (Object.keys(entry).some((key) => !fields.has(key))) throw new Error("Garage robot has unknown fields.");
    assertOpaqueId(entry.id, "robot entry");
    assertOpaqueId(entry.deviceId, "device");
    if (ids.has(entry.id)) throw new Error("Duplicate Garage robot.");
    ids.add(entry.id);
    if (!/^[0-9a-f]{64}$/.test(entry.tokenId)) throw new Error("Invalid Garage robot identity.");
    if (tokenIds.has(entry.tokenId)) throw new Error("Duplicate Garage robot identity.");
    tokenIds.add(entry.tokenId);
    if (typeof entry.nickname !== "string" || entry.nickname.length > 64) throw new Error("Garage robot value is too long.");
    if (entry.deleted && entry.nickname !== "") throw new Error("Invalid Garage tombstone name.");
    if (!Number.isSafeInteger(entry.revision) || entry.revision < 1) throw new Error("Invalid Garage robot revision.");
    if (!Number.isSafeInteger(entry.updatedAt) || entry.updatedAt < 0) throw new Error("Invalid Garage robot timestamp.");
  }
  const encoded = new TextEncoder().encode(JSON.stringify(manifest));
  if (encoded.length > GARAGE_LIMITS.plaintextBytes) throw new Error("Garage data is too large.");
}

export function validateGarageManifestForSecret(value: unknown, secret: Uint8Array): asserts value is GarageManifest {
  validateGarageManifest(value);
  for (const entry of value.entries) {
    if (garageTokenId(deriveGarageRobotToken(secret, entry.id)) !== entry.tokenId) {
      throw new Error("Invalid derived Garage robot.");
    }
  }
}

function replaceEntry(manifest: GarageManifest, entry: GarageRobotEntry, now: number): GarageManifest {
  const entries = manifest.entries.filter((candidate) => candidate.id !== entry.id);
  entries.push(entry);
  const next: GarageManifest = {
    ...manifest,
    revision: manifest.revision + 1,
    updatedAt: now,
    entries: entries.sort((left, right) => left.id.localeCompare(right.id))
  };
  validateGarageManifest(next);
  return next;
}

function compareGarageEntries(left: GarageRobotEntry, right: GarageRobotEntry): number {
  if (left.revision !== right.revision) return left.revision - right.revision;
  if (left.deleted !== right.deleted) return left.deleted ? 1 : -1;
  return left.deviceId.localeCompare(right.deviceId);
}

function cleanNickname(value: string): string {
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64) || "Robot";
}

function assertGarageSecret(secret: Uint8Array): void {
  if (!(secret instanceof Uint8Array) || secret.length !== 32 || secret.every((byte) => byte === 0)) {
    throw new Error("Invalid Garage secret.");
  }
}

function assertOpaqueId(value: string, label: string): void {
  if (!/^[0-9a-f]{32}$/.test(value.toLowerCase())) throw new Error(`Invalid ${label} ID.`);
}
