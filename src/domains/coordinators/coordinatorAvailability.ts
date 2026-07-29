import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";

export type CoordinatorAvailability = {
  checking: boolean;
  key: "available" | "available-checking" | "last-known-available" | "checking" | "not-checked" | "unavailable";
  label: string;
};

export function selectCoordinatorAvailability(coordinator: CoordinatorSummary): CoordinatorAvailability {
  if (coordinator.online && coordinator.loading) return { checking: true, key: "available-checking", label: "Available - checking" };
  if (coordinator.online && coordinator.error) return { checking: false, key: "last-known-available", label: "Last known available" };
  if (coordinator.online) return { checking: false, key: "available", label: "Available" };
  if (coordinator.loading) return { checking: true, key: "checking", label: "Checking" };
  if (coordinator.error) return { checking: false, key: "unavailable", label: "Unavailable" };
  return { checking: false, key: "not-checked", label: "Not checked" };
}

export function coordinatorNeedsRefresh(coordinator: CoordinatorSummary, maxAgeMs: number, now = Date.now()): boolean {
  return !coordinator.lastCheckedAt || now - coordinator.lastCheckedAt >= maxAgeMs;
}
