import { afterEach, describe, expect, it, vi } from "vitest";
import { generateRobotToken, isProFleetToken, validateTokenEntropy } from "@/domains/garage/token";

describe("generateRobotToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("matches the current base64-filtered token generator", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      const typed = array as Uint8Array;
      typed.forEach((_, index) => {
        typed[index] = 65 + index;
      });
      return array;
    });

    expect(generateRobotToken(8)).toBe("QUJDREVG");
  });

  it("returns an empty token for non-positive lengths", () => {
    expect(generateRobotToken(0)).toBe("");
  });
});

describe("validateTokenEntropy", () => {
  it("matches the current entropy threshold", () => {
    const entropy = validateTokenEntropy("4LFX4ILdIaqr2HNfbI4ePIHJXyh4QECofepb");

    expect(entropy.hasEnoughEntropy).toBe(true);
    expect(entropy.bitsEntropy).toBeGreaterThan(128);
    expect(entropy.shannonEntropy).toBeGreaterThan(4);
  });

  it("rejects low-entropy tokens with enough characters", () => {
    expect(validateTokenEntropy("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").hasEnoughEntropy).toBe(false);
  });
});

describe("isProFleetToken", () => {
  it("recognizes the Fleet key namespace without treating robot tokens as Fleet keys", () => {
    expect(isProFleetToken("  rsgarage1fleetkey  ")).toBe(true);
    expect(isProFleetToken("RSGARAGE1FLEETKEY")).toBe(true);
    expect(isProFleetToken("regularRobotToken123456789")).toBe(false);
  });
});
