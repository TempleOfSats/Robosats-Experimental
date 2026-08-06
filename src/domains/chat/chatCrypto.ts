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
  const { createMessage, decryptKey, encrypt, readKey, readPrivateKey } = await import("openpgp/lightweight");
  const signingKey = await decryptKey({
    privateKey: await readPrivateKey({ armoredKey: ownPrivateKeyArmored }),
    passphrase
  });
  const peerEncryptionKey = await readKey({ armoredKey: peerPublicKeyArmored });
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
  const { decrypt, decryptKey, readKey, readMessage, readPrivateKey } = await import("openpgp/lightweight");
  const decryptionKey = await decryptKey({
    privateKey: await readPrivateKey({ armoredKey: ownPrivateKeyArmored }),
    passphrase
  });
  let signerKeyAvailable = false;
  let verificationKeys: Awaited<ReturnType<typeof readKey>>[] = [];
  if (expectedSignerPublicKeyArmored) {
    try {
      verificationKeys = [await readKey({ armoredKey: expectedSignerPublicKeyArmored })];
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
