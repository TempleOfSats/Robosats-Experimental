import { describe, expect, it } from "vitest";
import {
  escapeArmoredKeyForHeader,
  generatePgpKeyPair,
  isCoordinatorCompatiblePgpKeyPair,
  signCleartextMessage
} from "@/domains/crypto/pgp";

describe("pgp helpers", () => {
  it("escapes armored keys for current auth headers", () => {
    expect(escapeArmoredKeyForHeader("line 1\nline 2")).toBe("line 1\\line 2");
  });

  it("generates current armored PGP keys", async () => {
    const keys = await generatePgpKeyPair("test-token-with-enough-entropy-1234567890");
    expect(keys.publicKeyArmored).toContain("BEGIN PGP PUBLIC KEY BLOCK");
    expect(keys.encryptedPrivateKeyArmored).toContain("BEGIN PGP PRIVATE KEY BLOCK");
    await expect(isCoordinatorCompatiblePgpKeyPair(keys.publicKeyArmored, keys.encryptedPrivateKeyArmored)).resolves.toBe(true);
  }, 30000);

  it("rejects malformed stored key pairs", async () => {
    await expect(isCoordinatorCompatiblePgpKeyPair("not-a-key", "not-a-key")).resolves.toBe(false);
  });

  it("signs cleartext payout payloads with current armor", async () => {
    const token = "test-token-with-enough-entropy-1234567890";
    const keys = await generatePgpKeyPair(token);
    const signed = await signCleartextMessage("lnbc1example", keys.encryptedPrivateKeyArmored, token);
    expect(signed).toContain("BEGIN PGP SIGNED MESSAGE");
    expect(signed).toContain("lnbc1example");
  }, 30000);
});
