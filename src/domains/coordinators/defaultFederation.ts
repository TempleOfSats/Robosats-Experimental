import type { CoordinatorDefinition } from "@/domains/coordinators/coordinator.types";
import federation from "@/domains/coordinators/federation.json";

const federationByAlias = federation as Record<string, CoordinatorDefinition>;

export const defaultFederation: CoordinatorDefinition[] = Object.values(federationByAlias);

export const remoteFederation: CoordinatorDefinition[] = Object.values(federationByAlias);
