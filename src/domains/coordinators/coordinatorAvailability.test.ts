import { describe, expect, it } from "vitest";
import { coordinatorNeedsRefresh, selectCoordinatorAvailability } from "@/domains/coordinators/coordinatorAvailability";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";

const base = {
  avatarUrl: "avatar.webp",
  badgeIcons: [],
  color: "#000",
  enabled: true,
  federated: true,
  longAlias: "Coordinator",
  online: false,
  shortAlias: "coordinator",
  smallAvatarUrl: "avatar.small.webp",
  url: "http://coordinator.onion"
} satisfies CoordinatorSummary;

describe("coordinator availability", () => {
  it("keeps a known available coordinator available while checking", () => {
    expect(selectCoordinatorAvailability({ ...base, loading: true, online: true })).toMatchObject({
      checking: true,
      key: "available-checking",
      label: "Available - checking"
    });
  });

  it("reserves unavailable for an attempted check that failed", () => {
    expect(selectCoordinatorAvailability(base).key).toBe("not-checked");
    expect(selectCoordinatorAvailability({ ...base, error: "Timed out" }).key).toBe("unavailable");
  });

  it("refreshes selected coordinators only after their successful check becomes stale", () => {
    expect(coordinatorNeedsRefresh(base, 300_000, 1_000_000)).toBe(true);
    expect(coordinatorNeedsRefresh({ ...base, lastCheckedAt: 900_000 }, 300_000, 1_000_000)).toBe(false);
    expect(coordinatorNeedsRefresh({ ...base, lastCheckedAt: 600_000 }, 300_000, 1_000_000)).toBe(true);
  });
});
