import { describe, expect, it } from "vitest";
import { getCoordinatorAvatarUrl, getCoordinatorBadgeIcons } from "@/domains/coordinators/coordinatorAssets";

describe("coordinator assets", () => {
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
