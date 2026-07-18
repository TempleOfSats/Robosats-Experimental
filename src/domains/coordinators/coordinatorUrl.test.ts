import { describe, expect, it } from "vitest";
import { buildCoordinatorUrl, detectCoordinatorOrigin } from "@/domains/coordinators/coordinatorUrl";
import type { CoordinatorDefinition } from "@/domains/coordinators/coordinator.types";

const coordinator: CoordinatorDefinition = {
  shortAlias: "lake",
  longAlias: "TheBigLake",
  color: "#000d28",
  mainnet: {
    onion: "http://lake.onion/",
    clearnet: "https://unsafe.thebiglake.org",
    i2p: ""
  },
  testnet: {
    onion: "http://test-lake.onion",
    clearnet: "https://test.unsafe.thebiglake.org",
    i2p: ""
  }
};

describe("buildCoordinatorUrl", () => {
  it("resolves the selected network and origin", () => {
    expect(buildCoordinatorUrl(coordinator, { network: "mainnet", origin: "onion" })).toBe("http://lake.onion");
    expect(buildCoordinatorUrl(coordinator, { network: "testnet", origin: "clearnet" })).toBe(
      "https://test.unsafe.thebiglake.org"
    );
  });

  it("uses the self-hosted proxy path for remote coordinators", () => {
    expect(
      buildCoordinatorUrl(coordinator, {
        network: "mainnet",
        origin: "onion",
        selfhostedClient: true,
        hostUrl: "https://client.example"
      })
    ).toBe("https://client.example/mainnet/lake");
  });

  it("lets local coordinator use the deployment override", () => {
    expect(
      buildCoordinatorUrl(
        { shortAlias: "local", longAlias: "Local", color: "#f5a524" },
        {
          network: "mainnet",
          origin: "clearnet",
          envBaseUrl: "https://robosats.local/"
        }
      )
    ).toBe("https://robosats.local");
  });
});

describe("detectCoordinatorOrigin", () => {
  it("uses onion and I2P coordinator routes when the app is served privately", () => {
    expect(detectCoordinatorOrigin("robosats.example.onion", false)).toBe("onion");
    expect(detectCoordinatorOrigin("client.i2p", false)).toBe("i2p");
    expect(detectCoordinatorOrigin("localhost", false)).toBe("clearnet");
  });

  it("uses onion coordinator routes inside an embedded Arti runtime", () => {
    expect(detectCoordinatorOrigin("appassets.androidplatform.net", true)).toBe("onion");
  });
});
