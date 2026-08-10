import { describe, expect, it } from "vitest";
import { fleetProtectionPresentation } from "@/domains/pro/proSyncPresentation";

describe("Fleet sync presentation", () => {
  it("only claims synchronization when no local changes are pending", () => {
    expect(fleetProtectionPresentation("up-to-date", 0, true).label).toBe("Fleet synced");
    expect(fleetProtectionPresentation("saving", 1, true)).toMatchObject({
      label: "Fleet syncing",
      tone: "syncing"
    });
    expect(fleetProtectionPresentation("idle", 1, true).label).toBe("Sync pending");
    expect(fleetProtectionPresentation("offline", 1, true)).toMatchObject({
      label: "Sync pending",
      tone: "pending"
    });
  });

  it("keeps a new local Fleet pending without implying active transfer", () => {
    expect(fleetProtectionPresentation("idle", 0, false)).toMatchObject({
      label: "Sync pending",
      tone: "pending"
    });
    expect(fleetProtectionPresentation("offline", 0, true)).toMatchObject({
      label: "Fleet synced",
      tone: "synced"
    });
  });
});
