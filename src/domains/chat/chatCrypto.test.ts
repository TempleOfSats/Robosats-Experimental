import { describe, expect, it } from "vitest";
import { generatePgpKeyPair } from "@/domains/crypto/pgp";
import { decryptChatMessage, encryptChatMessage } from "@/domains/chat/chatCrypto";

describe("chatCrypto", () => {
  it("derives the sender recipient from the private key so both peers can decrypt", async () => {
    const aliceToken = "alice-token-with-enough-entropy-1234567890";
    const bobToken = "bob-token-with-enough-entropy-1234567890";
    const alice = await generatePgpKeyPair(aliceToken);
    const bob = await generatePgpKeyPair(bobToken);

    const encrypted = await encryptChatMessage({
      message: "Fiat sent at 10:00",
      ownPrivateKeyArmored: alice.encryptedPrivateKeyArmored,
      passphrase: aliceToken,
      peerPublicKeyArmored: bob.publicKeyArmored
    });

    expect(encrypted).toContain("BEGIN PGP MESSAGE");
    await expect(
      decryptChatMessage({
        armoredMessage: encrypted,
        ownPrivateKeyArmored: bob.encryptedPrivateKeyArmored,
        passphrase: bobToken,
        expectedSignerPublicKeyArmored: alice.publicKeyArmored
      })
    ).resolves.toMatchObject({ plaintext: "Fiat sent at 10:00", signatureStatus: "verified" });
    await expect(
      decryptChatMessage({
        armoredMessage: encrypted,
        ownPrivateKeyArmored: alice.encryptedPrivateKeyArmored,
        passphrase: aliceToken,
        expectedSignerPublicKeyArmored: alice.publicKeyArmored
      })
    ).resolves.toMatchObject({ plaintext: "Fiat sent at 10:00", signatureStatus: "verified" });
  }, 30000);

  it("keeps plaintext usable while distinguishing unknown and failed signatures", async () => {
    const aliceToken = "alice-token-with-enough-entropy-1234567890";
    const bobToken = "bob-token-with-enough-entropy-1234567890";
    const carolToken = "carol-token-with-enough-entropy-1234567890";
    const alice = await generatePgpKeyPair(aliceToken);
    const bob = await generatePgpKeyPair(bobToken);
    const carol = await generatePgpKeyPair(carolToken);
    const encrypted = await encryptChatMessage({
      message: "signed payload",
      ownPrivateKeyArmored: alice.encryptedPrivateKeyArmored,
      passphrase: aliceToken,
      peerPublicKeyArmored: bob.publicKeyArmored
    });
    const decrypt = (expectedSignerPublicKeyArmored?: string) =>
      decryptChatMessage({
        armoredMessage: encrypted,
        ownPrivateKeyArmored: bob.encryptedPrivateKeyArmored,
        passphrase: bobToken,
        expectedSignerPublicKeyArmored
      });
    await expect(decrypt(alice.publicKeyArmored)).resolves.toMatchObject({
      plaintext: "signed payload",
      signatureStatus: "verified"
    });
    await expect(decrypt()).resolves.toMatchObject({ plaintext: "signed payload", signatureStatus: "unknown" });
    await expect(decrypt(carol.publicKeyArmored)).resolves.toMatchObject({
      plaintext: "signed payload",
      signatureStatus: "unverified"
    });
  }, 30000);
});
