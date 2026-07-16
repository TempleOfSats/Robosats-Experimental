export async function encryptChatMessage({
  message,
  ownPrivateKeyArmored,
  ownPublicKeyArmored,
  passphrase,
  peerPublicKeyArmored
}: {
  message: string;
  ownPrivateKeyArmored: string;
  ownPublicKeyArmored: string;
  passphrase: string;
  peerPublicKeyArmored: string;
}): Promise<string> {
  const { createMessage, decryptKey, encrypt, readKey, readPrivateKey } = await import("openpgp/lightweight");
  const signingKey = await decryptKey({
    privateKey: await readPrivateKey({ armoredKey: ownPrivateKeyArmored }),
    passphrase
  });
  const encryptionKeys = await Promise.all(
    uniqueArmoredKeys([peerPublicKeyArmored, ownPublicKeyArmored])
      .map((armoredKey) => readKey({ armoredKey }))
  );

  return String(
    await encrypt({
      message: await createMessage({ text: message }),
      encryptionKeys,
      signingKeys: signingKey
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
    uniqueArmoredKeys([peerPublicKeyArmored, ownPublicKeyArmored])
      .map((armoredKey) => readKey({ armoredKey }))
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
