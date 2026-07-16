import { sha256 } from "js-sha256";
export { escapeArmoredKeyForHeader } from "@/domains/crypto/pgpHeaders";

export interface PgpKeyPair {
  publicKeyArmored: string;
  encryptedPrivateKeyArmored: string;
}

export async function generatePgpKeyPair(highEntropyToken: string): Promise<PgpKeyPair> {
  const { generateKey } = await import("openpgp/lightweight");
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const keyPair = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: `RoboSats ID ${sha256(sha256(highEntropyToken))}` }],
    passphrase: highEntropyToken,
    format: "armored",
    date
  });

  return {
    publicKeyArmored: String(keyPair.publicKey),
    encryptedPrivateKeyArmored: String(keyPair.privateKey)
  };
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
