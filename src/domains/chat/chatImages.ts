import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { base64 } from "@scure/base";
import { sha256 } from "js-sha256";
import { finalizeEvent } from "nostr-tools/pure";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { transferBinary } from "@/domains/transport/binaryTransfer";
import { CHAT_IMAGE_TYPES, MAX_CHAT_IMAGE_BYTES, type ChatImageMetadata } from "@/domains/chat/chatImageMetadata";

export async function uploadChatImage(
  file: File,
  baseUrl: string,
  token: string,
  signal: AbortSignal
): Promise<ChatImageMetadata> {
  if (!CHAT_IMAGE_TYPES.includes(file.type)) throw new Error("Choose a JPEG, PNG, WebP or GIF image.");
  if (!file.size || file.size > MAX_CHAT_IMAGE_BYTES) throw new Error("Choose an image smaller than 10 MB.");
  const original = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const key = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const secret = deriveRobotIdentity(token).nostrSecKey;
  try {
    const ciphertext = xchacha20poly1305(key, nonce).encrypt(original);
    const hash = sha256(ciphertext);
    const createdAt = Math.floor(Date.now() / 1000);
    const event = finalizeEvent(
      {
        kind: 24242,
        created_at: createdAt,
        content: "Upload encrypted image",
        tags: [
          ["t", "upload"],
          ["x", hash],
          ["expiration", String(createdAt + 300)]
        ]
      },
      secret
    );
    const authorization = `Nostr ${base64.encode(new TextEncoder().encode(JSON.stringify(event)))}`;
    await transferBinary(baseUrl, "/blossom/upload", signal, { bytes: ciphertext, authorization });
    signal.throwIfAborted();
    return {
      type: "image",
      url: `${baseUrl.replace(/\/$/, "")}/blossom/${hash}`,
      key: base64.encode(key),
      nonce: base64.encode(nonce),
      sha256: hash,
      originalSha256: sha256(original),
      mimeType: file.type
    };
  } finally {
    key.fill(0);
    secret.fill(0);
    original.fill(0);
  }
}

export async function downloadChatImage(
  metadata: ChatImageMetadata,
  baseUrl: string,
  signal: AbortSignal
): Promise<Blob> {
  // A peer's URL is never a network destination: resolve the hash at this trade's coordinator.
  const ciphertext = await transferBinary(baseUrl, `/blossom/${metadata.sha256}`, signal);
  signal.throwIfAborted();
  if (ciphertext.length > MAX_CHAT_IMAGE_BYTES + 16 || sha256(ciphertext) !== metadata.sha256) {
    throw new Error("This image failed its integrity check.");
  }
  const key = base64.decode(metadata.key);
  try {
    const plaintext = xchacha20poly1305(key, base64.decode(metadata.nonce)).decrypt(ciphertext);
    try {
      if (metadata.originalSha256 && sha256(plaintext) !== metadata.originalSha256) {
        throw new Error("This image failed its integrity check.");
      }
      return new Blob([plaintext as Uint8Array<ArrayBuffer>], { type: metadata.mimeType });
    } finally {
      plaintext.fill(0);
    }
  } finally {
    key.fill(0);
  }
}
