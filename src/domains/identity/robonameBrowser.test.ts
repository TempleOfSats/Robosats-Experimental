import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ROBO_ADJECTIVES, ROBO_NOUNS } from "@/domains/identity/generated/robonameData";
import { generateBrowserRoboname } from "@/domains/identity/robonameBrowser";

describe("browser robot names", () => {
  it.each([
    ["3ee5dd464116bb1cbe225a07d4577b459cc49da215db0dec7e832d8cec3a6ec2", "BloomingProduce238"],
    ["0c007605495eb709f5572fcdef6acec89e3fcccf3cd0d919ed305904771c0b4d", "CuriousAdhesive448"],
    ["e2c7a42525878575087b8bbb6315d9c171925dbe6322272e55e631ada1bb458f", "LeftHook809"]
  ])("matches the native nickname for %s", (hashId, expected) => {
    expect(generateBrowserRoboname(hashId)).toBe(expected);
  });

  it("preserves the complete legacy word corpus", () => {
    expect(ROBO_ADJECTIVES).toHaveLength(4_832);
    expect(ROBO_NOUNS).toHaveLength(12_591);
    expect(hashLines(ROBO_ADJECTIVES)).toBe("c5820c29b54df46b9ef1b8cadbfe86311b3c7ccfddc476b7d67049d84eb6da08");
    expect(hashLines(ROBO_NOUNS)).toBe("7923402043aa4c319b9806ba85c0c40cbb9f4cf44aabd194e67943bca8215ef4");
  });

  it("matches an independent implementation for 2,048 deterministic identities", () => {
    const hashIds = [
      "0".repeat(64),
      "f".repeat(64),
      ...Array.from({ length: 2_046 }, (_, index) => sha256Hex(`experimental-fixture:${index}`))
    ];
    const failures: Array<{ hashId: string; expected: string; actual: string }> = [];
    let maxRetry = 0;

    for (const hashId of hashIds) {
      const reference = referenceRoboname(hashId);
      const actual = generateBrowserRoboname(hashId);
      maxRetry = Math.max(maxRetry, reference.retries);
      if (actual !== reference.name && failures.length < 20) {
        failures.push({ hashId, expected: reference.name, actual });
      }
    }

    expect(failures).toEqual([]);
    expect(maxRetry).toBe(12);
  });
});

function referenceRoboname(hashId: string): { name: string; retries: number } {
  const numberCount = 999n;
  const nounCount = BigInt(ROBO_NOUNS.length);
  const adjectiveBlock = numberCount * nounCount;
  const poolSize = adjectiveBlock * BigInt(ROBO_ADJECTIVES.length);
  const hashSpace = 1n << 256n;
  let current = hashId;

  for (let retries = 0; retries < 10_000; retries += 1) {
    const nicknameId = (BigInt(`0x${current}`) * poolSize) / hashSpace;
    const adjectiveId = nicknameId / adjectiveBlock;
    const remainder = nicknameId - adjectiveId * adjectiveBlock;
    const nounId = remainder / numberCount;
    const number = remainder - nounId * numberCount;
    const name = `${ROBO_ADJECTIVES[Number(adjectiveId)]}${ROBO_NOUNS[Number(nounId)]}${number}`;
    if (name.length <= 18) return { name, retries };
    current = sha256Hex(`${current}42`);
  }

  return { name: "", retries: 10_000 };
}

function hashLines(values: readonly string[]): string {
  return createHash("sha256")
    .update(`${values.join("\n")}\n`)
    .digest("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
