import type { CoordinatorDefinition } from "@/domains/coordinators/coordinator.types";

export type FederationDocument = Record<string, CoordinatorDefinition>;
const aliasPattern = /^[a-z0-9]{1,20}$/;

export function isFederationDocument(value: unknown): value is FederationDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 128) return false;
  return entries.every(([alias, candidate]) => {
    if (!aliasPattern.test(alias) || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return false;
    }
    const definition = candidate as Record<string, unknown>;
    const mainnet = definition.mainnet;
    const onion = mainnet && typeof mainnet === "object" ? (mainnet as Record<string, unknown>).onion : undefined;
    return definition.shortAlias === alias && typeof onion === "string" && onion.includes(".onion");
  });
}

export function applyBundledCoordinatorTrust(
  document: FederationDocument,
  bundledDocument: FederationDocument
): FederationDocument {
  return Object.fromEntries(
    Object.entries(document).map(([alias, definition]) => [
      alias,
      {
        ...definition,
        badges: bundledDocument[alias]?.badges ?? {
          isFounder: false,
          donatesToDevFund: 0,
          hasGoodOpSec: false,
          hasLargeLimits: false
        }
      }
    ])
  );
}
