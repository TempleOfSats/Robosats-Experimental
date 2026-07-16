import { describe, expect, it } from "vitest";
import { parseArguments, releaseMetadata } from "./release-metadata.mjs";

describe("release metadata", () => {
  it("orders prerelease channels before the stable release", () => {
    const versions = ["0.1.0-alpha.1", "0.1.0-beta.1", "0.1.0-rc.1", "0.1.0"];
    const codes = versions.map((version) => Number(releaseMetadata(version).build_number));
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
  });

  it("uses the SemVer core as the iOS marketing version", () => {
    expect(releaseMetadata("1.4.7-beta.12")).toMatchObject({
      ios_version: "1.4.7",
      prerelease: "true"
    });
  });

  it("rejects unsupported version formats", () => {
    expect(() => releaseMetadata("0.1 alpha")).toThrow(/Unsupported release version/);
  });

  it("parses a release tag supplied as the first argument", () => {
    expect(parseArguments(["v0.1.0-alpha.1"])).toEqual({
      requestedValue: undefined,
      tag: "v0.1.0-alpha.1"
    });
  });

  it("keeps value-only queries separate from release tags", () => {
    expect(parseArguments(["--value", "ios_version"])).toEqual({
      requestedValue: "ios_version",
      tag: undefined
    });
  });

  it("rejects ambiguous command-line arguments", () => {
    expect(() => parseArguments(["v0.1.0", "v0.2.0"])).toThrow(/Unexpected argument/);
    expect(() => parseArguments(["--value"])).toThrow(/requires a metadata field/);
    expect(() => parseArguments(["--unknown"])).toThrow(/Unknown option/);
  });
});
