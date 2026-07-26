import { describe, expect, it } from "vitest";
import {
  activeGarageEntries,
  createGarageEntryId,
  createGarageManifest,
  decodeGarageToken,
  deriveGarageRobotToken,
  encodeGarageToken,
  garageTokenId,
  GARAGE_LIMITS,
  hasGarageRobotCapacity,
  mergeGarageManifests,
  removeGarageEntry,
  upsertGarageEntry,
  validateGarageManifest,
  validateGarageManifestForSecret
} from "@/domains/pro/garageVault";

const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const deviceA = "00112233445566778899aabbccddeeff";
const deviceB = "ffeeddccbbaa99887766554433221100";
const entryId = "1234567890abcdef1234567890abcdef";

function derivedEntry(id: string, nickname: string) {
  return { id, nickname, tokenId: garageTokenId(deriveGarageRobotToken(secret, id)) };
}

describe("Garage vault primitives", () => {
  it("round trips the versioned Garage token", () => {
    const encoded = encodeGarageToken(secret);
    expect(encoded).toBe("rsgarage1qyqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqyl952a");
    expect(decodeGarageToken(encoded)).toEqual(secret);
    expect(decodeGarageToken(encoded.toUpperCase())).toEqual(secret);
    expect(() => decodeGarageToken(`R${encoded.slice(1)}`)).toThrow("Invalid Fleet key");
    expect(() => decodeGarageToken(encoded.replace(/.$/, "q"))).toThrow("Invalid Fleet key");
  });

  it("derives stable unbiased-alphabet robot tokens from entry IDs", () => {
    const token = deriveGarageRobotToken(secret, entryId);
    expect(token).toHaveLength(36);
    expect(token).toMatch(/^[A-Za-z0-9]+$/);
    expect(deriveGarageRobotToken(secret, entryId)).toBe(token);
    expect(deriveGarageRobotToken(secret, deviceA)).not.toBe(token);
  });

  it("allocates collision-resistant entry IDs with the frozen 128-bit shape", () => {
    const ids = new Set(Array.from({ length: 256 }, () => createGarageEntryId()));
    expect(ids.size).toBe(256);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("matches the frozen robot derivation vectors", () => {
    const vectors = [
      [1, "11111111111111111111111111111111", "pGkguhilZGzROXScZ0l38zKiYkZJkeEjf6a6"],
      [2, "22222222222222222222222222222222", "4tw6cPO4h6R10MOg0YmX70LpfBhNF0izBZNf"],
      [3, "33333333333333333333333333333333", "QHOnr6AbDdWRHy42efpmnXeKjPCU7DlW1JDy"],
      [4, "44444444444444444444444444444444", "BWt6Iczh4mQ4iJmGsYFB8RkpF1HruOPaK8cL"],
      [5, "55555555555555555555555555555555", "tFqinxPfOAuLXLsisW9wc3vRTZ2R3p9gZUio"]
    ] as const;
    for (const [offset, id, expected] of vectors) {
      const vectorSecret = Uint8Array.from({ length: 32 }, (_, index) => index + offset);
      expect(deriveGarageRobotToken(vectorSecret, id)).toBe(expected);
    }
  });

  it("stores derivation identifiers without robot tokens", () => {
    const manifest = upsertGarageEntry(createGarageManifest(deviceA, 1), derivedEntry(entryId, "Robot"), 2);
    expect(JSON.stringify(manifest)).toBe(
      '{"format":"robosats-exp-garage","version":1,"deviceId":"00112233445566778899aabbccddeeff","revision":1,"updatedAt":2,"entries":[{"id":"1234567890abcdef1234567890abcdef","tokenId":"f0b3e4e7712c057deae2a3a18f3b22a3ac01d0d62df1fda51fd4ae80d1d56f35","nickname":"Robot","revision":1,"deviceId":"00112233445566778899aabbccddeeff","deleted":false,"updatedAt":2}]}'
    );
  });

  it("creates irreversible tombstones without retaining robot material", () => {
    let manifest = createGarageManifest(deviceA, 1);
    manifest = upsertGarageEntry(manifest, derivedEntry(entryId, "Alice"), 2);
    expect(activeGarageEntries(manifest)).toHaveLength(1);

    manifest = removeGarageEntry(manifest, entryId, 3);
    expect(activeGarageEntries(manifest)).toEqual([]);
    expect(manifest.entries[0]).toMatchObject({ deleted: true, nickname: "", revision: 2 });
    expect(manifest.entries[0]).not.toHaveProperty("token");
  });

  it("limits active robots while letting a removal restore capacity", () => {
    let manifest = createGarageManifest(deviceA, 1);
    for (let index = 0; index < GARAGE_LIMITS.activeRobots; index += 1) {
      const id = index.toString(16).padStart(32, "0");
      manifest = upsertGarageEntry(manifest, derivedEntry(id, `Robot ${index + 1}`), index + 2);
    }

    expect(activeGarageEntries(manifest)).toHaveLength(GARAGE_LIMITS.activeRobots);
    expect(hasGarageRobotCapacity(manifest)).toBe(false);

    manifest = removeGarageEntry(manifest, manifest.entries[0].id, 100);
    expect(activeGarageEntries(manifest)).toHaveLength(GARAGE_LIMITS.activeRobots - 1);
    expect(hasGarageRobotCapacity(manifest)).toBe(true);
  });

  it("preserves concurrent robots above the local creation limit", () => {
    let first = createGarageManifest(deviceA, 1);
    let second = createGarageManifest(deviceB, 1);
    for (let index = 0; index < 9; index += 1) {
      const firstId = index.toString(16).padStart(32, "0");
      const secondId = (index + 16).toString(16).padStart(32, "0");
      first = upsertGarageEntry(first, derivedEntry(firstId, `First ${index}`), index + 2);
      second = upsertGarageEntry(second, derivedEntry(secondId, `Second ${index}`), index + 2);
    }

    const merged = mergeGarageManifests([first, second], deviceA, 100);
    expect(activeGarageEntries(merged)).toHaveLength(18);
    expect(hasGarageRobotCapacity(merged)).toBe(false);
  });

  it("rejects prototype entries containing raw or imported robot data", () => {
    const manifest = upsertGarageEntry(createGarageManifest(deviceA, 1), derivedEntry(entryId, "Robot"), 2);
    expect(() => validateGarageManifest({
      ...manifest,
      entries: [{ ...manifest.entries[0], token: "ImportedRobotToken012345678901234567" }]
    })).toThrow("unknown fields");
    expect(() => validateGarageManifest({
      ...manifest,
      entries: [{ ...manifest.entries[0], source: "imported" }]
    })).toThrow("unknown fields");
  });

  it("merges by revision, then tombstone, then device ID", () => {
    const first = upsertGarageEntry(createGarageManifest(deviceA, 1), derivedEntry(entryId, "First"), 2);
    const second = upsertGarageEntry(createGarageManifest(deviceB, 1), derivedEntry(entryId, "Second"), 2);
    const merged = mergeGarageManifests([first, second], deviceA, 4);
    expect(merged.entries[0].nickname).toBe("Second");

    const removed = removeGarageEntry(first, entryId, 5);
    const mergedWithRemoval = mergeGarageManifests([second, removed], deviceB, 6);
    expect(mergedWithRemoval.entries[0].deleted).toBe(true);
  });

  it("adopts restored data under the current device identity", () => {
    const restored = upsertGarageEntry(createGarageManifest(deviceA, 1), derivedEntry(entryId, "Restored"), 2);
    const adopted = mergeGarageManifests([createGarageManifest(deviceB, 3), restored], deviceB, 4);

    expect(adopted.deviceId).toBe(deviceB);
    expect(adopted.entries).toEqual(restored.entries);
    expect(adopted.revision).toBeGreaterThan(restored.revision);
  });

  it("does not overwrite a concurrent local change from the same device", () => {
    const firstId = "11111111111111111111111111111111";
    const secondId = "22222222222222222222222222222222";
    const stale = upsertGarageEntry(createGarageManifest(deviceA, 1), derivedEntry(firstId, "First"), 2);
    const current = upsertGarageEntry(stale, derivedEntry(secondId, "Second"), 3);

    const adopted = mergeGarageManifests([current, stale], deviceA, 4);
    expect(activeGarageEntries(adopted).map((entry) => entry.nickname)).toEqual(["First", "Second"]);
  });

  it("rejects duplicate IDs and oversized manifests", () => {
    const manifest = upsertGarageEntry(createGarageManifest(deviceA), derivedEntry(entryId, "Robot"));
    expect(() => validateGarageManifest({ ...manifest, entries: [...manifest.entries, ...manifest.entries] }))
      .toThrow("Duplicate Garage robot");
  });

  it("rejects a derived token that does not match its entry ID", () => {
    const manifest = upsertGarageEntry(createGarageManifest(deviceA), derivedEntry(entryId, "Robot"));
    expect(() => validateGarageManifestForSecret({
      ...manifest,
      entries: [{ ...manifest.entries[0], tokenId: garageTokenId(deriveGarageRobotToken(secret, deviceA)) }]
    }, secret)).toThrow("Invalid derived Garage robot");
  });

  it("rejects a token identity derived from another Garage secret", () => {
    const otherSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 2);
    const manifest = upsertGarageEntry(createGarageManifest(deviceA), {
      id: entryId,
      nickname: "Robot",
      tokenId: garageTokenId(deriveGarageRobotToken(otherSecret, entryId))
    });
    expect(() => validateGarageManifestForSecret(manifest, secret)).toThrow("Invalid derived Garage robot");
  });

  it("rejects device and robot counts above the defensive limits", () => {
    const manifests = Array.from({ length: 33 }, (_, index) => createGarageManifest(
      index.toString(16).padStart(32, "0")
    ));
    expect(() => mergeGarageManifests(manifests, deviceA)).toThrow("Too many Garage devices");

    const manifest = createGarageManifest(deviceA);
    expect(() => validateGarageManifest({
      ...manifest,
      entries: Array.from({ length: 129 })
    })).toThrow("Garage robot limit exceeded");
  });
});
