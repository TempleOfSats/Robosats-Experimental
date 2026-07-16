import type {
  CoordinatorBadgeIcon,
  CoordinatorBadges,
  CoordinatorDefinition
} from "@/domains/coordinators/coordinator.types";

const staticBase = "/static";
const androidStaticBase = "file:///android_asset/static";

export function getCoordinatorAvatarUrl(shortAlias: string, size: "small" | "large" = "large", android = false): string {
  const base = android ? androidStaticBase : staticBase;
  const suffix = size === "small" ? ".small" : "";
  return `${base}/federation/avatars/${shortAlias}${suffix}.webp`;
}

export function getCoordinatorBadgeIcons(coordinator: Pick<CoordinatorDefinition, "badges">): CoordinatorBadgeIcon[] {
  const badges = coordinator.badges ?? defaultBadges;
  return [
    {
      key: "isFounder",
      label: "Founder",
      title:
        badges.isFounder === true
          ? "Founder: coordinating trades since the testnet federation."
          : "Not a federation founder",
      iconUrl: badgeAsset("Fundator.svg"),
      active: badges.isFounder === true
    },
    {
      key: "donatesToDevFund",
      label: "Dev fund",
      title: `Development fund supporter: donates ${badges.donatesToDevFund}% to make RoboSats better.`,
      iconUrl: badgeAsset("DevFundSupporter.svg"),
      active: Number(badges.donatesToDevFund) >= 20,
      value: `${badges.donatesToDevFund}%`
    },
    {
      key: "hasGoodOpSec",
      label: "Good OpSec",
      title:
        badges.hasGoodOpSec === true
          ? "Good OpSec: the coordinator follows best practices to protect privacy."
          : "The privacy practices of this coordinator could improve",
      iconUrl: badgeAsset("GoodPrivacy.svg"),
      active: badges.hasGoodOpSec === true
    },
    {
      key: "hasLargeLimits",
      label: "Large limits",
      title:
        badges.hasLargeLimits === true
          ? "Large limits: this coordinator supports larger trades."
          : "This coordinator has more limited trade size",
      iconUrl: badgeAsset("LargeLimits.svg"),
      active: badges.hasLargeLimits === true
    }
  ];
}

const defaultBadges: CoordinatorBadges = {
  isFounder: false,
  donatesToDevFund: 0,
  hasGoodOpSec: false,
  hasLargeLimits: false
};

function badgeAsset(filename: string): string {
  return `${staticBase}/assets/vector/${filename}`;
}
