import { remoteFederation } from "@/domains/coordinators/defaultFederation";
import type { CoordinatorDefinition } from "@/domains/coordinators/coordinator.types";

export function federationLottery(coordinators: CoordinatorDefinition[] = remoteFederation): string[] {
  return coordinators
    .map((coordinator) => ({
      shortAlias: coordinator.shortAlias,
      chance: Math.min(coordinator.badges?.donatesToDevFund ?? 0, 50)
    }))
    .sort((a, b) => Math.random() * b.chance - Math.random() * a.chance)
    .map((coordinator) => coordinator.shortAlias);
}
