import { beforeEach, describe, expect, it, vi } from "vitest";

const readKeyMock = vi.hoisted(() => vi.fn(async ({ armoredKey }: { armoredKey: string }) => ({ armoredKey })));
const readPrivateKeyMock = vi.hoisted(() => vi.fn(async ({ armoredKey }: { armoredKey: string }) => ({ armoredKey })));
const decryptKeyMock = vi.hoisted(() =>
  vi.fn(async ({ privateKey }: { privateKey: { armoredKey: string } }) => ({
    armoredKey: privateKey.armoredKey,
    toPublic: () => ({ armoredKey: `${privateKey.armoredKey}:public` })
  }))
);
const encryptMock = vi.hoisted(() =>
  vi.fn(async ({ encryptionKeys }: { encryptionKeys: Array<{ armoredKey: string }> }) => encryptionKeys[0].armoredKey)
);

vi.mock("openpgp/lightweight", () => ({
  createMessage: vi.fn(async ({ text }: { text: string }) => ({ text })),
  decryptKey: decryptKeyMock,
  encrypt: encryptMock,
  readKey: readKeyMock,
  readPrivateKey: readPrivateKeyMock
}));

import { encryptChatMessage, resetChatCryptoCachesForTests } from "@/domains/chat/chatCrypto";

beforeEach(() => {
  resetChatCryptoCachesForTests();
  readKeyMock.mockClear();
  readPrivateKeyMock.mockClear();
  decryptKeyMock.mockClear();
  encryptMock.mockClear();
});

describe("chat key cache", () => {
  it("keeps keys separate when the former 32-bit fingerprint collided", async () => {
    await expect(encryptFor("Aa")).resolves.toBe("Aa");
    await expect(encryptFor("BB")).resolves.toBe("BB");

    expect(readKeyMock).toHaveBeenCalledTimes(2);
  });

  it("removes rejected entries so a transient key read can recover", async () => {
    readKeyMock.mockRejectedValueOnce(new Error("temporary parse failure"));

    await expect(encryptFor("peer-key")).rejects.toThrow("temporary parse failure");
    await expect(encryptFor("peer-key")).resolves.toBe("peer-key");
    expect(readKeyMock).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used public key when the cache is full", async () => {
    for (let index = 0; index < 33; index += 1) {
      await encryptFor(`peer-${index}`);
    }
    await encryptFor("peer-0");

    expect(readKeyMock).toHaveBeenCalledTimes(34);
  });
});

function encryptFor(peerPublicKeyArmored: string): Promise<string> {
  return encryptChatMessage({
    message: "hello",
    ownPrivateKeyArmored: "own-private-key",
    passphrase: "passphrase",
    peerPublicKeyArmored
  });
}
