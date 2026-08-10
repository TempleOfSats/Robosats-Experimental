import type { PgpKeyPair } from "@/domains/crypto/pgpKeyGeneration";
export { escapeArmoredKeyForHeader } from "@/domains/crypto/pgpHeaders";
export type { PgpKeyPair } from "@/domains/crypto/pgpKeyGeneration";

export async function generatePgpKeyPair(highEntropyToken: string): Promise<PgpKeyPair> {
  const { generatePgpKeyPairOffMainThread } = await import("@/domains/crypto/pgpKeyGenerationClient");
  return generatePgpKeyPairOffMainThread(highEntropyToken);
}

export async function isCoordinatorCompatiblePgpKeyPair(
  publicKeyArmored: string,
  privateKeyArmored: string
): Promise<boolean> {
  try {
    const { readKey, readPrivateKey } = await import("openpgp/lightweight");
    const [publicKey, privateKey] = await Promise.all([
      readKey({ armoredKey: publicKeyArmored }),
      readPrivateKey({ armoredKey: privateKeyArmored })
    ]);
    const publicPacket = publicKey as typeof publicKey & { keyPacket?: { version?: number } };
    const privatePacket = privateKey as typeof privateKey & { keyPacket?: { version?: number } };
    return publicPacket.keyPacket?.version === 4
      && privatePacket.keyPacket?.version === 4
      && publicKey.getFingerprint() === privateKey.getFingerprint();
  } catch {
    return false;
  }
}

export async function signCleartextMessage(
  message: string,
  privateKeyArmored: string,
  passphrase: string
): Promise<string> {
  const { createCleartextMessage, decryptKey, readPrivateKey, sign } = await import("openpgp/lightweight");
  const privateKey = await decryptKey({
    privateKey: await readPrivateKey({ armoredKey: privateKeyArmored }),
    passphrase
  });
  const unsignedMessage = await createCleartextMessage({ text: message });
  return String(
    await sign({
      message: unsignedMessage,
      signingKeys: privateKey
    })
  );
}
