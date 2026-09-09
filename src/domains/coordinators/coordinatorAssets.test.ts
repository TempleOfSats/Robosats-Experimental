import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getCoordinatorAvatarUrl, getCoordinatorBadgeIcons } from "@/domains/coordinators/coordinatorAssets";

describe("coordinator assets", () => {
  it.each(["ammanaya", "eleuteria", "freeport"])("bundles both upstream avatar sizes for %s", (alias) => {
    for (const size of ["small", "large"] as const) {
      const suffix = size === "small" ? ".small" : "";
      const path = `/static/federation/avatars/${alias}${suffix}.webp`;
      expect(getCoordinatorAvatarUrl(alias, size)).toBe(path);
      expect(getCoordinatorAvatarUrl(alias, size, true)).toBe(`file:///android_asset${path}`);
      const bytes = readFileSync(new URL(`../../../public${path}`, import.meta.url));
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
      expect(bytes.length).toBeLessThan(size === "small" ? 8 * 1024 : 32 * 1024);
    }
  });

  it("resolves every bundled avatar and keeps small/large pairs complete", () => {
    const directory = new URL("../../../public/static/federation/avatars/", import.meta.url);
    const files = readdirSync(directory).filter((name) => name.endsWith(".webp"));
    for (const name of files) {
      const alias = name.replace(/(?:\.small)?\.webp$/, "");
      expect(files).toContain(`${alias}.webp`);
      expect(files).toContain(`${alias}.small.webp`);
      expect(getCoordinatorAvatarUrl(alias, name.endsWith(".small.webp") ? "small" : "large")).toBe(
        `/static/federation/avatars/${name}`
      );
    }
  });

  it.each(["futurecoordinator", "../unexpected", "https://unexpected.test/image"])(
    "uses local artwork for an unbundled alias: %s",
    (alias) => {
      expect(getCoordinatorAvatarUrl(alias)).toBe("/static/federation/avatars/local.webp");
      expect(getCoordinatorAvatarUrl(alias, "small", true)).toBe(
        "file:///android_asset/static/federation/avatars/local.small.webp"
      );
    }
  );

  it("preserves current coordinator avatar paths", () => {
    expect(getCoordinatorAvatarUrl("lake")).toBe("/static/federation/avatars/lake.webp");
    expect(getCoordinatorAvatarUrl("lake", "small")).toBe("/static/federation/avatars/lake.small.webp");
    expect(getCoordinatorAvatarUrl("lake", "small", true)).toBe(
      "file:///android_asset/static/federation/avatars/lake.small.webp"
    );
  });

  it("preserves current coordinator badge icon names and thresholds", () => {
    const badges = getCoordinatorBadgeIcons({
      badges: {
        isFounder: true,
        donatesToDevFund: 20,
        hasGoodOpSec: true,
        hasLargeLimits: false
      }
    });

    expect(badges.map((badge) => badge.iconUrl)).toEqual([
      "/static/assets/vector/Fundator.svg",
      "/static/assets/vector/DevFundSupporter.svg",
      "/static/assets/vector/GoodPrivacy.svg",
      "/static/assets/vector/LargeLimits.svg"
    ]);
    expect(badges.map((badge) => badge.active)).toEqual([true, true, true, false]);
  });
});
