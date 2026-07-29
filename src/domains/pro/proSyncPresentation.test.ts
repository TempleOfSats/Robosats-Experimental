import { describe, expect, it } from "vitest";
import { fleetProtectionPresentation } from "@/domains/pro/proSyncPresentation";

describe("Fleet sync presentation", () => {
  it("only claims synchronization when no local changes are pending", () => {
    expect(fleetProtectionPresentation("up-to-date", 0, true).label).toBe("Fleet synced");
    expect(fleetProtectionPresentation("idle", 1, true).label).toBe("Fleet syncing");
    expect(fleetProtectionPresentation("offline", 1, true)).toMatchObject({
      label: "Fleet syncing",
      tone: "syncing"
    });
  });

  it("keeps a new local Fleet in the syncing state until a record is observed", () => {
    expect(fleetProtectionPresentation("idle", 0, false)).toMatchObject({
      label: "Fleet syncing",
      tone: "syncing"
    });
    expect(fleetProtectionPresentation("offline", 0, true)).toMatchObject({
      label: "Fleet synced",
      tone: "synced"
    });
  });
});
