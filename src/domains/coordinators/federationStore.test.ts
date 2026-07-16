import { describe, expect, it } from "vitest";
import {
  buildCoordinatorSummary,
  FEDERATION_CACHE_MAX_AGE_MS,
  FEDERATION_REFRESH_MIN_INTERVAL_MS
} from "@/domains/coordinators/federationStore";
import { defaultFederation } from "@/domains/coordinators/defaultFederation";
import type { CoordinatorDefinition } from "@/domains/coordinators/coordinator.types";

const coordinator: CoordinatorDefinition = {
  shortAlias: "lake",
  longAlias: "TheBigLake",
  identifier: "thebiglake",
  color: "#000D28",
  description: "Coordinator description",
  motto: "Economic freedom",
  established: "2023-12-30",
  federated: true,
  nostrHexPubkey: "nostr-hex",
  mainnet: {
    onion: "http://lake.onion",
    clearnet: "https://unsafe.thebiglake.org",
    i2p: ""
  },
  testnet: {
    onion: "http://test-lake.onion",
    clearnet: "https://test.unsafe.thebiglake.org",
    i2p: ""
  },
  mainnetNodesPubkeys: ["mainnet-node"],
  testnetNodesPubkeys: ["testnet-node"],
  contact: {
    email: "coordinator@example.com",
    pgp: "/static/federation/pgp/key.asc",
    fingerprint: "FINGERPRINT"
  },
  badges: {
    isFounder: true,
    donatesToDevFund: 30,
    hasGoodOpSec: true,
    hasLargeLimits: true
  },
  policies: {
    "Privacy Policy": "No third-party sharing."
  }
};

describe("buildCoordinatorSummary", () => {
  it("contains only the current built-in federation", () => {
    expect(defaultFederation.map((item) => item.shortAlias)).not.toContain("freedomsats");
  });

  it("keeps background metadata refreshes well inside the cache lifetime", () => {
    expect(FEDERATION_REFRESH_MIN_INTERVAL_MS).toBe(10 * 60 * 1000);
    expect(FEDERATION_REFRESH_MIN_INTERVAL_MS).toBeLessThan(FEDERATION_CACHE_MAX_AGE_MS);
  });

  it("keeps full federation metadata for coordinator details", () => {
    const summary = buildCoordinatorSummary(coordinator, {
      network: "mainnet",
      origin: "clearnet",
      selfhostedClient: false
    });

    expect(summary).toMatchObject({
      shortAlias: "lake",
      longAlias: "TheBigLake",
      identifier: "thebiglake",
      federated: true,
      url: "https://unsafe.thebiglake.org",
      nostrHexPubkey: "nostr-hex",
      mainnetNodesPubkeys: ["mainnet-node"],
      testnetNodesPubkeys: ["testnet-node"],
      contact: {
        email: "coordinator@example.com",
        fingerprint: "FINGERPRINT"
      },
      policies: {
        "Privacy Policy": "No third-party sharing."
      }
    });
    expect(summary.mainnet?.onion).toBe("http://lake.onion");
    expect(summary.testnet?.clearnet).toBe("https://test.unsafe.thebiglake.org");
    expect(summary.badgeIcons.map((badge) => badge.active)).toEqual([true, true, true, true]);
  });
});
