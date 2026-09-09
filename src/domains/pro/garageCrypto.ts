import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getPublicKey } from "nostr-tools/pure";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";

const encoder = new TextEncoder();
const salt = encoder.encode("robosats-exp:garage-keys:v2");

export type GarageKeyDomain =
  "local" | "offline-backup" | "garage-sync" | "settings-sync" | "history-sync" | "trade-cache";

export function deriveGarageDomainKey(secret: Uint8Array, domain: GarageKeyDomain): Uint8Array {
  for (let counter = 0; counter < 256; counter += 1) {
    const key = hkdf(sha256, secret, salt, encoder.encode(`robosats-exp:${domain}:v2:${counter}`), 32);
    try {
      getPublicKey(key);
      return key;
    } catch {
      continue;
    }
  }
  throw new Error("Could not derive Garage encryption key.");
}

export function encryptGaragePayload(secret: Uint8Array, domain: GarageKeyDomain, plaintext: string): string {
  return encrypt(plaintext, conversationKey(secret, domain));
}

export function decryptGaragePayload(secret: Uint8Array, domain: GarageKeyDomain, ciphertext: string): string {
  return decrypt(ciphertext, conversationKey(secret, domain));
}

/**
 * The active Fleet keeps one NIP-44 conversation key per key domain instead of
 * running the HKDF search and shared-secret derivation for every payload. Each
 * `encrypt` call still asks the library for a fresh message nonce — only the
 * conversation key is reused, and no nonce, ciphertext, or cipher instance is.
 *
 * The cache owns a copy of the secret it was activated with, so callers may
 * `.slice()` or zero their own arrays freely. A payload for any other Fleet —
 * a recovery preview, an offline import, or an operation that started before a
 * restore — derives on the spot and never replaces the active session.
 */
let activeSecret: Uint8Array | undefined;
const conversationKeys = new Map<GarageKeyDomain, Uint8Array>();

export function activateGarageCryptoCache(secret: Uint8Array): void {
  if (activeSecret && isSameSecret(activeSecret, secret)) return;
  discardCache();
  activeSecret = secret.slice();
}

export function clearGarageCryptoCache(): void {
  discardCache();
}

function conversationKey(secret: Uint8Array, domain: GarageKeyDomain): Uint8Array {
  if (!activeSecret || !isSameSecret(activeSecret, secret)) return deriveConversationKey(secret, domain);
  const cached = conversationKeys.get(domain);
  if (cached) return cached;
  const derived = deriveConversationKey(activeSecret, domain);
  conversationKeys.set(domain, derived);
  return derived;
}

function deriveConversationKey(secret: Uint8Array, domain: GarageKeyDomain): Uint8Array {
  const key = deriveGarageDomainKey(secret, domain);
  return getConversationKey(key, getPublicKey(key));
}

function discardCache(): void {
  for (const key of conversationKeys.values()) key.fill(0);
  conversationKeys.clear();
  // Best effort only: JavaScript cannot guarantee removal of every engine or
  // library copy of these bytes.
  activeSecret?.fill(0);
  activeSecret = undefined;
}

function isSameSecret(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
