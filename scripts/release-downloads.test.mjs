import { describe, expect, it } from "vitest";
import { releaseDownloadSection } from "./release-downloads.mjs";

const artifacts = [
  "robosats-exp-0.1.2-alpha.1-arm64-v8a.apk",
  "robosats-exp-0.1.2-alpha.1-universal.apk",
  "robosats-exp-0.1.2-alpha.1-x86_64.apk",
  "robosats-exp-0.1.2-alpha.1-unsigned.ipa",
  "RoboSats.Exp_0.1.2-alpha.1_amd64.AppImage",
  "RoboSats Exp. 0.1.2-alpha.1.exe",
  "RoboSats Exp. 0.1.2-alpha.1.dmg"
];

describe("releaseDownloadSection", () => {
  it("links each application and selects only the universal Android APK", () => {
    const section = releaseDownloadSection(
      artifacts,
      "https://github.com",
      "example/robosats-exp",
      "v0.1.2-alpha.1"
    );

    expect(section).toContain("## Downloads");
    expect(section).toContain(
      "[Android universal APK](https://github.com/example/robosats-exp/releases/download/v0.1.2-alpha.1/robosats-exp-0.1.2-alpha.1-universal.apk)"
    );
    expect(section).not.toContain("arm64-v8a");
    expect(section).not.toContain("x86_64.apk");
    expect(section).toContain("RoboSats%20Exp.%200.1.2-alpha.1.exe");
    expect(section).toContain("RoboSats%20Exp.%200.1.2-alpha.1.dmg");
    expect(section.match(/^\* \[/gm)).toHaveLength(5);
  });

  it("rejects a missing application package", () => {
    expect(() =>
      releaseDownloadSection(
        artifacts.filter((filename) => !filename.endsWith(".dmg")),
        "https://github.com",
        "example/robosats-exp",
        "v0.1.2-alpha.1"
      )
    ).toThrow(/Expected one macOS DMG artifact, found 0/);
  });

  it("rejects duplicate application packages", () => {
    expect(() =>
      releaseDownloadSection(
        [...artifacts, "another-universal.apk"],
        "https://github.com",
        "example/robosats-exp",
        "v0.1.2-alpha.1"
      )
    ).toThrow(/Expected one Android universal APK artifact, found 2/);
  });
});
