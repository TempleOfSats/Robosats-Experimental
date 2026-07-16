import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { RobotKeysDialog, robotCredentials } from "@/domains/garage/RobotKeysDialog";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";

const identity = deriveRobotIdentity("correct horse battery staple");
const slot: RobotSlot = {
  ...identity,
  nickname: "Robot",
  earnedRewards: 0,
  robots: {
    lake: {
      token: identity.token,
      shortAlias: "lake",
      pubKey: "PUBLIC PGP KEY",
      encPrivKey: "ENCRYPTED PRIVATE PGP KEY"
    }
  }
};

describe("RobotKeysDialog", () => {
  it("derives the same Nostr identity and includes the stored OpenPGP credentials", () => {
    const credentials = robotCredentials(slot);
    expect(credentials.nostrPublicKey).toMatch(/^npub1/);
    expect(credentials.nostrPrivateKey).toMatch(/^nsec1/);
    expect(credentials.pgpPublicKey).toBe("PUBLIC PGP KEY");
    expect(credentials.pgpEncryptedPrivateKey).toBe("ENCRYPTED PRIVATE PGP KEY");
    expect(credentials.passphrase).toBe(identity.token);
  });

  it("renders the current verification sections and copy actions", () => {
    const html = renderToStaticMarkup(<RobotKeysDialog slot={slot} onClose={() => undefined} />);
    expect(html).toContain("Don&#x27;t trust, verify");
    expect(html).toContain("Nostr");
    expect(html).toContain("OpenPGP");
    expect(html).toContain("Your encrypted private key");
    expect(html).toContain("Copy Your private key");
    expect(html).toContain("Export keys");
  });
});
