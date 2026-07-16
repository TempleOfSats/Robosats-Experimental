import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";

type EstablishedCoordinator = Pick<CoordinatorSummary, "established" | "longAlias">;

export function compareCoordinatorsByEstablished(
  left: EstablishedCoordinator,
  right: EstablishedCoordinator
): number {
  const order = establishedAt(left.established) - establishedAt(right.established);
  return order || left.longAlias.localeCompare(right.longAlias);
}

function establishedAt(value?: string): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}
