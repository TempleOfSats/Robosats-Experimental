import { sha256 } from "js-sha256";

type PrivateKey = import("openpgp/lightweight").PrivateKey;
type PublicKey = import("openpgp/lightweight").PublicKey;

const MAX_PRIVATE_KEY_CACHE_ENTRIES = 8;
const MAX_PUBLIC_KEY_CACHE_ENTRIES = 32;
const privateKeyCache = new Map<string, Promise<PrivateKey>>();
const publicKeyCache = new Map<string, Promise<PublicKey>>();

function cacheDigest(...parts: string[]): string {
  const digest = sha256.create();
  for (const part of parts) {
    digest.update(`${part.length}:`);
    digest.update(part);
  }
  return digest.hex();
}

function getOrCreateCached<T>(
  cache: Map<string, Promise<T>>,
  cacheKey: string,
  maxEntries: number,
  create: () => Promise<T>
): Promise<T> {
  const existing = cache.get(cacheKey);
  if (existing) {
    cache.delete(cacheKey);
    cache.set(cacheKey, existing);
    return existing;
  }

  const pending = create().catch((error: unknown) => {
    if (cache.get(cacheKey) === pending) cache.delete(cacheKey);
    throw error;
  });
  cache.set(cacheKey, pending);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cache.delete(oldest);
  }
  return pending;
}

function getCachedPrivateKey(armoredKey: string, passphrase: string): Promise<PrivateKey> {
  return getOrCreateCached(
    privateKeyCache,
    cacheDigest(armoredKey, passphrase),
    MAX_PRIVATE_KEY_CACHE_ENTRIES,
    async () => {
      const { decryptKey, readPrivateKey } = await import("openpgp/lightweight");
      return decryptKey({
        privateKey: await readPrivateKey({ armoredKey }),
        passphrase
      });
    }
  );
}

function getCachedPublicKey(armoredKey: string): Promise<PublicKey> {
  return getOrCreateCached(publicKeyCache, cacheDigest(armoredKey), MAX_PUBLIC_KEY_CACHE_ENTRIES, async () => {
    const { readKey } = await import("openpgp/lightweight");
    return readKey({ armoredKey });
  });
}

export function resetChatCryptoCachesForTests(): void {
  privateKeyCache.clear();
  publicKeyCache.clear();
}

export async function encryptChatMessage({
  message,
  ownPrivateKeyArmored,
  passphrase,
  peerPublicKeyArmored
}: {
  message: string;
  ownPrivateKeyArmored: string;
  passphrase: string;
  peerPublicKeyArmored: string;
}): Promise<string> {
  const { createMessage, encrypt } = await import("openpgp/lightweight");
  const signingKey = await getCachedPrivateKey(ownPrivateKeyArmored, passphrase);
  const peerEncryptionKey = await getCachedPublicKey(peerPublicKeyArmored);
  const date = new Date();
  date.setDate(date.getDate() - 1);

  return String(
    await encrypt({
      message: await createMessage({ text: message }),
      encryptionKeys: [peerEncryptionKey, signingKey.toPublic()],
      signingKeys: signingKey,
      date
    })
  );
}

type ChatSignatureStatus = "verified" | "unverified" | "unknown";

export interface DecryptedChatMessage {
  plaintext: string;
  signatureStatus: ChatSignatureStatus;
}

export async function decryptChatMessage({
  armoredMessage,
  ownPrivateKeyArmored,
  passphrase,
  expectedSignerPublicKeyArmored
}: {
  armoredMessage: string;
  ownPrivateKeyArmored: string;
  passphrase: string;
  expectedSignerPublicKeyArmored?: string;
}): Promise<DecryptedChatMessage> {
  const { decrypt, readMessage } = await import("openpgp/lightweight");
  const decryptionKey = await getCachedPrivateKey(ownPrivateKeyArmored, passphrase);

  let signerKeyAvailable = false;
  let verificationKeys: import("openpgp/lightweight").PublicKey[] = [];
  if (expectedSignerPublicKeyArmored) {
    try {
      const signerKey = await getCachedPublicKey(expectedSignerPublicKeyArmored);
      verificationKeys = [signerKey];
      signerKeyAvailable = true;
    } catch {
      // Decrypt without verification when the expected signer key is unavailable.
    }
  }

  const { data, signatures } = await decrypt({
    message: await readMessage({ armoredMessage }),
    decryptionKeys: decryptionKey,
    verificationKeys
  });

  let signatureStatus: ChatSignatureStatus = "unknown";
  if (expectedSignerPublicKeyArmored && signerKeyAvailable) {
    signatureStatus = "unverified";
    const signature = signatures?.[0];
    if (signature) {
      try {
        await signature.verified;
        signatureStatus = "verified";
      } catch {
        // Plaintext remains usable when signature verification fails.
      }
    }
  }
  return { plaintext: String(data), signatureStatus };
}
