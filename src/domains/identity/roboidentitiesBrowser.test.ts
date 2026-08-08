import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateBrowserRobohash,
  generateBrowserRoboname,
  selectRobotIdentity
} from "@/domains/identity/roboidentitiesBrowser";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("emits one canonical SVG that scales at every display size", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(identityAssetPack())));

    const avatar = await generateBrowserRobohash("a".repeat(64));
    const svg = Buffer.from(avatar.slice(avatar.indexOf(",") + 1), "base64").toString("utf8");

    expect(svg).toMatch(/^<svg[^>]+viewBox="0 0 256 256"/);
    expect(svg).not.toMatch(/^<svg[^>]+\s(?:width|height)=/);
    expect(svg.match(/<image width="256" height="256"/g)).toHaveLength(6);
  });
});

function identityAssetPack(): ArrayBuffer {
  const count = 77;
  const dataOffset = 12 + count * 8;
  const pack = new ArrayBuffer(dataOffset + 1);
  const bytes = new Uint8Array(pack);
  bytes.set(new TextEncoder().encode("RSIDPK01"));
  const view = new DataView(pack);
  view.setUint16(8, count, true);
  for (let index = 0; index < count; index += 1) {
    view.setUint32(12 + index * 8, dataOffset, true);
    view.setUint32(16 + index * 8, 1, true);
  }
  return pack;
}
