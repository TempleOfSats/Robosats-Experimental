import { sha256 } from "js-sha256";

export interface PgpKeyPair {
  publicKeyArmored: string;
  encryptedPrivateKeyArmored: string;
}

export async function generatePgpKeyPairOnCurrentThread(highEntropyToken: string): Promise<PgpKeyPair> {
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
