import { describe, expect, it } from "vitest";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";

describe("deriveRobotIdentity", () => {
  it("matches current deterministic identity fields for a token", () => {
    const identity = deriveRobotIdentity("correct horse battery staple");

    expect(identity.hashId).toBe("1dbc6e9fc4cee6acc5f3acebaf126827625166d04aaf954ea32f308439ba693d");
    expect(identity.tokenSHA256).toBe("K>m`!r0=?!Tkv2gxjpk|GQ.`znQ/ER<9.=P{]SED");
    expect(identity.nostrPubKey).toBe("1d44b50654dc12ee1e9b62886b3510d76e7f5cb51d6a94313a7aea246c76c1b2");
    expect(identity.hasEnoughEntropy).toBe(false);
  });

  it("marks very weak tokens as weak", () => {
    expect(deriveRobotIdentity("aaaa").hasEnoughEntropy).toBe(false);
  });
});
