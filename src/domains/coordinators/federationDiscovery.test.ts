import { describe, expect, it } from "vitest";
import {
  hashFederationDocument,
  normalizeFederationDocument,
  voteOnFederationHashes
} from "@/domains/coordinators/federationConsensus";
import {
  applyBundledCoordinatorTrust,
  isFederationDocument,
  type FederationDocument
} from "@/domains/coordinators/federationDiscovery";

const now = new Date("2026-08-28T00:00:00Z");
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

describe("federation discovery", () => {
  it("hashes only canonical identity and reachability fields", async () => {
    const document = federationDocument();
    const cosmeticChange = federationDocument();
    cosmeticChange.temple.description = "Updated description";
    cosmeticChange.temple.badges = { donatesToDevFund: 50 };

    expect(normalizeFederationDocument(document).temple).toMatchObject({
      mainnet: { clearnet: "", i2p: "" }
    });
    expect(await hashFederationDocument(cosmeticChange)).toBe(await hashFederationDocument(document));
  });

  it("matches the federation canonical-hash contract", async () => {
    expect(await hashFederationDocument(federationDocument())).toBe(
      "7881013196a61497ddbe56de9b439cdaa5e09ef10ce02a2bf089d87e0d67b690"
    );
  });

  it("validates aliases and requires a mainnet onion endpoint", () => {
    expect(isFederationDocument(federationDocument())).toBe(true);
    expect(isFederationDocument({})).toBe(false);
    expect(isFederationDocument({ BadAlias: federationDocument().temple })).toBe(false);
    expect(isFederationDocument({ temple: { ...federationDocument().temple, mainnet: {} } })).toBe(false);
  });

  it("requires two votes and a strict seniority-weighted majority", () => {
    const bundled = federationDocument();
    expect(voteOnFederationHashes([{ alias: "temple", hash: hashA }], bundled, {}, now)).toBeUndefined();
    expect(
      voteOnFederationHashes(
        [
          { alias: "temple", hash: hashA },
          { alias: "lake", hash: hashB },
          { alias: "newcomer", hash: hashA }
        ],
        bundled,
        { newcomer: "2026-08-28" },
        now
      )
    ).toBe(hashA);
  });

  it("does not trust a newcomer coordinator's self-reported seniority", () => {
    const bundled = federationDocument();
    const served = {
      ...bundled,
      newcomer: definition("newcomer", "2020-01-01")
    };
    expect(
      voteOnFederationHashes(
        [
          { alias: "temple", hash: hashA },
          { alias: "lake", hash: hashA },
          { alias: "newcomer", hash: hashB }
        ],
        bundled,
        { newcomer: "2026-08-28" },
        now
      )
    ).toBe(hashA);
    expect(served.newcomer.established).toBe("2020-01-01");
  });

  it("keeps bundled badges and gives newly voted-in coordinators neutral badges", () => {
    const bundled = federationDocument();
    const remote: FederationDocument = {
      ...bundled,
      temple: { ...bundled.temple },
      newcomer: { ...definition("newcomer", "2020-01-01"), badges: { donatesToDevFund: 100 } }
    };
    remote.temple.badges = { donatesToDevFund: 0 };

    const trusted = applyBundledCoordinatorTrust(remote, bundled);
    expect(trusted.temple.badges?.donatesToDevFund).toBe(30);
    expect(trusted.newcomer.badges).toEqual({
      isFounder: false,
      donatesToDevFund: 0,
      hasGoodOpSec: false,
      hasLargeLimits: false
    });
  });

  it("does not rewrite hash-bearing fields when badges are reapplied", async () => {
    const bundled = federationDocument();
    const remote = federationDocument();
    remote.lake.federated = false;

    const trusted = applyBundledCoordinatorTrust(remote, bundled);

    expect(trusted.lake.federated).toBe(false);
    expect(await hashFederationDocument(trusted)).toBe(await hashFederationDocument(remote));
  });
});

function federationDocument(): FederationDocument {
  return {
    temple: { ...definition("temple", "2023-12-02"), badges: { donatesToDevFund: 30 } },
    lake: definition("lake", "2023-12-30")
  };
}

function definition(alias: string, established: string) {
  return {
    shortAlias: alias,
    longAlias: alias,
    color: "#000000",
    established,
    federated: true,
    nostrHexPubkey: "a".repeat(64),
    mainnet: { onion: `http://${alias}.onion`, clearnet: null, i2p: null },
    testnet: { onion: null, clearnet: null, i2p: null },
    mainnetNodesPubkeys: [],
    testnetNodesPubkeys: []
  };
}
