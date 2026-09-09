import { beforeEach, describe, expect, it, vi } from "vitest";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getPublicKey } from "nostr-tools/pure";
import {
  activateGarageCryptoCache,
  clearGarageCryptoCache,
  decryptGaragePayload,
  encryptGaragePayload,
  type GarageKeyDomain
} from "@/domains/pro/garageCrypto";

/**
 * Counts conversation-key derivations inside the production module and remembers
 * a stable fingerprint of each result, so the tests can tell a reused key from a
 * freshly derived one. Fingerprints never enter assertion messages.
 */
const trace = vi.hoisted(() => ({ derivations: [] as string[] }));

vi.mock("nostr-tools/nip44", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-tools/nip44")>();
  const fingerprint = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    ...actual,
    getConversationKey: (secretKey: Uint8Array, publicKey: string) => {
      const key = actual.getConversationKey(secretKey, publicKey);
      trace.derivations.push(fingerprint(key));
      return key;
    }
  };
});

const DOMAINS: GarageKeyDomain[] = [
  "local",
  "offline-backup",
  "garage-sync",
  "settings-sync",
  "history-sync",
  "trade-cache"
];

// Synthetic key material generated for this test file only.
const fleetSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const otherFleetSecret = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);

// The original, uncached derivation path reproduced here so the tests compare
// against real pre-change wire behaviour rather than against the new module.
const encoder = new TextEncoder();
const salt = encoder.encode("robosats-exp:garage-keys:v2");

function uncachedDomainKey(secret: Uint8Array, domain: GarageKeyDomain): Uint8Array {
  for (let counter = 0; counter < 256; counter += 1) {
    const key = hkdf(sha256, secret, salt, encoder.encode(`robosats-exp:${domain}:v2:${counter}`), 32);
    try {
      getPublicKey(key);
      return key;
    } catch {
      continue;
    }
  }
  throw new Error("no key");
}

async function originalPath() {
  const nip44 = await vi.importActual<typeof import("nostr-tools/nip44")>("nostr-tools/nip44");
  return {
    encrypt: (secret: Uint8Array, domain: GarageKeyDomain, plaintext: string) => {
      const key = uncachedDomainKey(secret, domain);
      return nip44.encrypt(plaintext, nip44.getConversationKey(key, getPublicKey(key)));
    },
    decrypt: (secret: Uint8Array, domain: GarageKeyDomain, ciphertext: string) => {
      const key = uncachedDomainKey(secret, domain);
      return nip44.decrypt(ciphertext, nip44.getConversationKey(key, getPublicKey(key)));
    }
  };
}

beforeEach(() => {
  trace.derivations.length = 0;
  clearGarageCryptoCache();
});

describe("Fleet payload compatibility", () => {
  for (const domain of DOMAINS) {
    it(`keeps the ${domain} wire format in both directions`, async () => {
      const original = await originalPath();

      expect(decryptGaragePayload(fleetSecret, domain, original.encrypt(fleetSecret, domain, "fleet record"))).toBe(
        "fleet record"
      );
      expect(original.decrypt(fleetSecret, domain, encryptGaragePayload(fleetSecret, domain, "fleet record"))).toBe(
        "fleet record"
      );
    });

    it(`decrypts a stored ${domain} payload after the Fleet session activates`, async () => {
      const original = await originalPath();
      const stored = original.encrypt(fleetSecret, domain, "stored record");

      activateGarageCryptoCache(fleetSecret);

      expect(decryptGaragePayload(fleetSecret, domain, stored)).toBe("stored record");
    });
  }

  it("still uses a fresh nonce per message for one cached conversation key", () => {
    activateGarageCryptoCache(fleetSecret);

    const first = encryptGaragePayload(fleetSecret, "local", "same plaintext");
    const second = encryptGaragePayload(fleetSecret, "local", "same plaintext");

    expect(first).not.toBe(second);
    expect(decryptGaragePayload(fleetSecret, "local", first)).toBe("same plaintext");
    expect(decryptGaragePayload(fleetSecret, "local", second)).toBe("same plaintext");
  });

  it("rejects malformed ciphertext and ciphertext from another Fleet", () => {
    activateGarageCryptoCache(fleetSecret);
    const ciphertext = encryptGaragePayload(fleetSecret, "local", "fleet record");

    expect(() => decryptGaragePayload(fleetSecret, "local", "not-a-payload")).toThrow();
    expect(() => decryptGaragePayload(otherFleetSecret, "local", ciphertext)).toThrow();
    expect(() => decryptGaragePayload(fleetSecret, "history-sync", ciphertext)).toThrow();
  });
});

describe("Fleet conversation-key cache", () => {
  it("derives one conversation key per active Fleet and domain", async () => {
    const original = await originalPath();
    activateGarageCryptoCache(fleetSecret);

    const ciphertext = encryptGaragePayload(fleetSecret, "settings-sync", "first");
    expect(decryptGaragePayload(fleetSecret.slice(), "settings-sync", ciphertext)).toBe("first");
    const second = encryptGaragePayload(fleetSecret.slice(), "settings-sync", "second");

    expect(trace.derivations).toHaveLength(1);
    expect(original.decrypt(fleetSecret, "settings-sync", second)).toBe("second");
  });

  it("derives a separate conversation key per domain", () => {
    activateGarageCryptoCache(fleetSecret);

    encryptGaragePayload(fleetSecret, "local", "one");
    encryptGaragePayload(fleetSecret, "settings-sync", "two");

    expect(trace.derivations).toHaveLength(2);
    expect(trace.derivations[0] === trace.derivations[1]).toBe(false);
  });

  it("keeps a non-active Fleet out of the active cache", async () => {
    const original = await originalPath();
    activateGarageCryptoCache(fleetSecret);
    encryptGaragePayload(fleetSecret, "local", "active");

    const foreign = encryptGaragePayload(otherFleetSecret, "local", "recovery preview");
    expect(trace.derivations).toHaveLength(2);
    expect(trace.derivations[1] === trace.derivations[0]).toBe(false);
    expect(decryptGaragePayload(otherFleetSecret, "local", foreign)).toBe("recovery preview");
    expect(trace.derivations).toHaveLength(3);

    // The active Fleet still uses its own conversation key after the preview.
    const stillActive = encryptGaragePayload(fleetSecret, "local", "still active");
    expect(trace.derivations).toHaveLength(3);
    expect(original.decrypt(fleetSecret, "local", stillActive)).toBe("still active");
    expect(original.decrypt(otherFleetSecret, "local", foreign)).toBe("recovery preview");
  });

  it("derives again after the cache is cleared or replaced", async () => {
    const original = await originalPath();
    activateGarageCryptoCache(fleetSecret);
    encryptGaragePayload(fleetSecret, "local", "one");
    expect(trace.derivations).toHaveLength(1);

    clearGarageCryptoCache();
    const two = encryptGaragePayload(fleetSecret, "local", "two");
    expect(trace.derivations).toHaveLength(2);

    activateGarageCryptoCache(otherFleetSecret);
    const three = encryptGaragePayload(otherFleetSecret, "local", "three");
    expect(trace.derivations).toHaveLength(3);

    const four = encryptGaragePayload(fleetSecret, "local", "four");
    expect(trace.derivations).toHaveLength(4);
    expect(original.decrypt(fleetSecret, "local", two)).toBe("two");
    expect(original.decrypt(otherFleetSecret, "local", three)).toBe("three");
    expect(original.decrypt(fleetSecret, "local", four)).toBe("four");
  });

  it("ignores a caller mutating the array it activated the cache with", () => {
    const callerCopy = fleetSecret.slice();
    activateGarageCryptoCache(callerCopy);
    encryptGaragePayload(fleetSecret, "local", "one");

    callerCopy.fill(0);

    encryptGaragePayload(fleetSecret, "local", "two");
    expect(trace.derivations).toHaveLength(1);
  });
});
