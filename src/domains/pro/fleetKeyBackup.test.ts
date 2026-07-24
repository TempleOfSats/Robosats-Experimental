import { describe, expect, it } from "vitest";
import { buildFleetKeyBackup } from "@/domains/pro/fleetKeyBackup";
import { createGarageSecret, encodeGarageToken } from "@/domains/pro/garageVault";

describe("Fleet key backup", () => {
  it("stores only the normalized Fleet key in a versioned JSON document", () => {
    const fleetKey = encodeGarageToken(createGarageSecret());

    expect(buildFleetKeyBackup(`  ${fleetKey}\n`)).toEqual({
      format: "robosats-exp-fleet-key",
      version: 1,
      fleetKey
    });
  });

  it("rejects malformed Fleet keys", () => {
    expect(() => buildFleetKeyBackup("not-a-fleet-key")).toThrow("Invalid Fleet key");
  });
});
