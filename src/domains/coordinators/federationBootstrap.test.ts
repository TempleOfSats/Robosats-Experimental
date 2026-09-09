import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("federation bootstrap", () => {
  it("starts from the last hash-verified document without waiting for the network", async () => {
    installStorage(
      JSON.stringify({
        newcomer: {
          shortAlias: "newcomer",
          longAlias: "New Coordinator",
          color: "#123456",
          federated: true,
          nostrHexPubkey: "f".repeat(64),
          mainnet: { onion: "http://newcomer.onion", clearnet: null, i2p: null },
          testnet: { onion: null, clearnet: null, i2p: null }
        }
      })
    );

    const { useFederationStore } = await import("@/domains/coordinators/federationStore");

    expect(useFederationStore.getState().coordinators).toEqual([
      expect.objectContaining({ shortAlias: "newcomer", url: "http://newcomer.onion" })
    ]);
  });

  it("falls back to the bundled federation when the persisted document is malformed", async () => {
    installStorage(JSON.stringify({ newcomer: { shortAlias: "newcomer" } }));

    const [{ useFederationStore }, { defaultFederation }] = await Promise.all([
      import("@/domains/coordinators/federationStore"),
      import("@/domains/coordinators/defaultFederation")
    ]);

    expect(useFederationStore.getState().coordinators.map((item) => item.shortAlias)).toEqual(
      defaultFederation.map((item) => item.shortAlias)
    );
  });
});

function installStorage(manifest: string): void {
  const values = new Map([["federation_manifest", manifest]]);
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", {
    localStorage,
    location: { hostname: "client.onion", origin: "http://client.onion" }
  });
}
