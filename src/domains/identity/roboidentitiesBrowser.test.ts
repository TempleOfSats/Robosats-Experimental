import { describe, expect, it } from "vitest";
import {
  generateBrowserRoboname,
  selectRobotIdentity
} from "@/domains/identity/roboidentitiesBrowser";

describe("browser robot identities", () => {
  it.each([
    ["3ee5dd464116bb1cbe225a07d4577b459cc49da215db0dec7e832d8cec3a6ec2", "BloomingProduce238"],
    ["0c007605495eb709f5572fcdef6acec89e3fcccf3cd0d919ed305904771c0b4d", "CuriousAdhesive448"],
    ["e2c7a42525878575087b8bbb6315d9c171925dbe6322272e55e631ada1bb458f", "LeftHook809"]
  ])("matches the native nickname for %s", (hash, expected) => {
    expect(generateBrowserRoboname(hash)).toBe(expected);
  });

  it("maps a SHA-512 digest to stable layers and hue", () => {
    expect(
      selectRobotIdentity(
        "92ba5204aca5e21f60d40dda5b64e0e64e46028da5d33d2b577a0c80b6ed2843b46a458bbb0023d2634ecc7bccb2678e0b33f5ec0144fb124174325113396ef4"
      )
    ).toEqual({
      parts: [2, 14, 23, 34, 51],
      background: 58,
      hue: 267
    });
  });
});
