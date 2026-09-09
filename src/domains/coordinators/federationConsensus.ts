import type { FederationDocument } from "@/domains/coordinators/federationDiscovery";

export type FederationHashVote = { alias: string; hash: string };

const identityFields = [
  "shortAlias",
  "nostrHexPubkey",
  "established",
  "federated",
  "mainnetNodesPubkeys",
  "testnetNodesPubkeys"
] as const;
const networkFields = ["onion", "clearnet", "i2p"] as const;
const oneYearMs = 365 * 24 * 60 * 60 * 1000;
const minimumWeight = 1;
const establishedWeight = 4;
const maximumWeight = 10;

export function normalizeFederationDocument(document: FederationDocument): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(document).map(([alias, definition]) => {
      const normalized: Record<string, unknown> = {};
      const source = definition as unknown as Record<string, unknown>;
      identityFields.forEach((field) => {
        normalized[field] = source[field] ?? null;
      });
      (["mainnet", "testnet"] as const).forEach((network) => {
        const urls =
          source[network] && typeof source[network] === "object" ? (source[network] as Record<string, unknown>) : {};
        normalized[network] = Object.fromEntries(networkFields.map((field) => [field, urls[field] ?? ""]));
      });
      return [alias, normalized];
    })
  );
}

export async function hashFederationDocument(document: FederationDocument): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(normalizeFederationDocument(document)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function voteOnFederationHashes(
  votes: FederationHashVote[],
  bundledDocument: FederationDocument,
  joinDates: Record<string, string>,
  now = new Date()
): string | undefined {
  const uniqueVotes = [...new Map(votes.map((vote) => [vote.alias, vote])).values()];
  if (uniqueVotes.length < 2) return undefined;

  const dates = uniqueVotes.map((vote) => trustedEstablishedDate(vote.alias, bundledDocument, joinDates));
  const oldest = dates.reduce<Date | undefined>((current, date) => {
    if (!date || (current && current <= date)) return current;
    return date;
  }, undefined);
  const weights = new Map<string, number>();
  let totalWeight = 0;

  uniqueVotes.forEach((vote, index) => {
    const weight = seniorityWeight(dates[index], oldest, now);
    weights.set(vote.hash, (weights.get(vote.hash) ?? 0) + weight);
    totalWeight += weight;
  });

  return [...weights].find(([, weight]) => weight * 2 > totalWeight)?.[0];
}

function trustedEstablishedDate(
  alias: string,
  bundledDocument: FederationDocument,
  joinDates: Record<string, string>
): Date | undefined {
  const value = bundledDocument[alias]?.established ?? joinDates[alias];
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function seniorityWeight(established: Date | undefined, oldest: Date | undefined, now: Date): number {
  if (!established || !oldest) return minimumWeight;
  const age = now.getTime() - established.getTime();
  const oldestAge = now.getTime() - oldest.getTime();
  if (age < 0 || oldestAge <= 0) return minimumWeight;
  if (age < oneYearMs) {
    return minimumWeight + Math.floor(((establishedWeight - minimumWeight - 1) * age) / oneYearMs);
  }
  if (oldestAge <= oneYearMs) return establishedWeight;
  return (
    establishedWeight + Math.floor(((maximumWeight - establishedWeight) * (age - oneYearMs)) / (oldestAge - oneYearMs))
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}
