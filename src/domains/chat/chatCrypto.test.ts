import { describe, expect, it } from "vitest";
import { generatePgpKeyPair } from "@/domains/crypto/pgp";
import { decryptChatMessage, encryptChatMessage } from "@/domains/chat/chatCrypto";

describe("chatCrypto", () => {
  it("encrypts signed chat messages that both peers can decrypt", async () => {
    const aliceToken = "alice-token-with-enough-entropy-1234567890";
    const bobToken = "bob-token-with-enough-entropy-1234567890";
    const alice = await generatePgpKeyPair(aliceToken);
    const bob = await generatePgpKeyPair(bobToken);

    const encrypted = await encryptChatMessage({
      message: "Fiat sent at 10:00",
      ownPrivateKeyArmored: alice.encryptedPrivateKeyArmored,
      ownPublicKeyArmored: alice.publicKeyArmored,
      passphrase: aliceToken,
      peerPublicKeyArmored: bob.publicKeyArmored
    });

    expect(encrypted).toContain("BEGIN PGP MESSAGE");
    await expect(
      decryptChatMessage({
        armoredMessage: encrypted,
        ownPrivateKeyArmored: bob.encryptedPrivateKeyArmored,
        ownPublicKeyArmored: bob.publicKeyArmored,
        passphrase: bobToken,
        peerPublicKeyArmored: alice.publicKeyArmored
      })
    ).resolves.toBe("Fiat sent at 10:00");
    await expect(
      decryptChatMessage({
        armoredMessage: encrypted,
        ownPrivateKeyArmored: alice.encryptedPrivateKeyArmored,
        ownPublicKeyArmored: alice.publicKeyArmored,
        passphrase: aliceToken,
        peerPublicKeyArmored: bob.publicKeyArmored
      })
    ).resolves.toBe("Fiat sent at 10:00");
  }, 30000);
});
