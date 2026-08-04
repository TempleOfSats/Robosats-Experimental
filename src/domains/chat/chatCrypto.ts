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

export async function decryptChatMessage({
  armoredMessage,
  ownPrivateKeyArmored,
  ownPublicKeyArmored,
  passphrase,
  peerPublicKeyArmored
}: {
  armoredMessage: string;
  ownPrivateKeyArmored: string;
  ownPublicKeyArmored: string;
  passphrase: string;
  peerPublicKeyArmored?: string;
}): Promise<string> {
  const { decrypt, decryptKey, readKey, readMessage, readPrivateKey } = await import("openpgp/lightweight");
  const decryptionKey = await decryptKey({
    privateKey: await readPrivateKey({ armoredKey: ownPrivateKeyArmored }),
    passphrase
  });
  const verificationKeys = await Promise.all(
    uniqueArmoredKeys([peerPublicKeyArmored, ownPublicKeyArmored]).map((armoredKey) => readKey({ armoredKey }))
  );
  const { data } = await decrypt({
    message: await readMessage({ armoredMessage }),
    decryptionKeys: decryptionKey,
    verificationKeys
  });

  return String(data);
}

function uniqueArmoredKeys(keys: Array<string | undefined>): string[] {
  return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}
