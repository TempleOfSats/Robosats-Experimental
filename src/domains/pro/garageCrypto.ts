import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getPublicKey } from "nostr-tools/pure";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";

const encoder = new TextEncoder();
const salt = encoder.encode("robosats-exp:garage-keys:v2");

export type GarageKeyDomain =
  | "local"
  | "garage-sync"
  | "settings-sync"
  | "history-sync"
  | "trade-cache";

export function deriveGarageDomainKey(secret: Uint8Array, domain: GarageKeyDomain): Uint8Array {
  for (let counter = 0; counter < 256; counter += 1) {
    const key = hkdf(
      sha256,
      secret,
      salt,
      encoder.encode(`robosats-exp:${domain}:v2:${counter}`),
      32
    );
    try {
      getPublicKey(key);
      return key;
    } catch {
      // A uniformly derived 32-byte value is almost always a valid secp256k1 key.
    }
  }
  throw new Error("Could not derive Garage encryption key.");
}

export function encryptGaragePayload(secret: Uint8Array, domain: GarageKeyDomain, plaintext: string): string {
  const key = deriveGarageDomainKey(secret, domain);
  return encrypt(plaintext, getConversationKey(key, getPublicKey(key)));
}

export function decryptGaragePayload(secret: Uint8Array, domain: GarageKeyDomain, ciphertext: string): string {
  const key = deriveGarageDomainKey(secret, domain);
  return decrypt(ciphertext, getConversationKey(key, getPublicKey(key)));
}
