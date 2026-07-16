import { finalizeEvent, verifyEvent, type Event } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { buildNostrRelayUrl, selectNostrRelays } from "@/domains/orderbook/nostrOrderbook";

const RATING_KIND = 31986;
const RATINGS_SINCE = 1_746_316_800;
export interface CoordinatorRating { score: number; count: number }

export async function fetchCoordinatorRatings(coordinators: CoordinatorSummary[]): Promise<Record<string, CoordinatorRating>> {
  const targets = coordinators.filter((item) => item.enabled && item.nostrHexPubkey && buildNostrRelayUrl(item));
  const relays = selectNostrRelays(targets, window.location.origin, 1);
  const pubkeys = targets.flatMap((item) => item.nostrHexPubkey ? [item.nostrHexPubkey] : []);
  if (!relays.length || !pubkeys.length) return {};
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(relays, { kinds: [RATING_KIND], "#p": pubkeys, since: RATINGS_SINCE }, { maxWait: 10_000 });
    return ratingsFromEvents(events, targets);
  } finally { pool.destroy(); }
}

function ratingsFromEvents(events: Event[], coordinators: CoordinatorSummary[]): Record<string, CoordinatorRating> {
  const values = new Map<string, number[]>();
  for (const event of events) {
    if (!verifyEvent(event)) continue;
    const pubkey = event.tags.find((tag) => tag[0] === "p")?.[1];
    const normalized = Number(event.tags.find((tag) => tag[0] === "rating")?.[1]);
    if (!pubkey || !Number.isFinite(normalized) || normalized < 0 || normalized > 1) continue;
    values.set(pubkey, [...(values.get(pubkey) ?? []), normalized * 5]);
  }
  return Object.fromEntries(coordinators.map((coordinator) => {
    const ratings = coordinator.nostrHexPubkey ? values.get(coordinator.nostrHexPubkey) ?? [] : [];
    return [coordinator.shortAlias, { score: ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 0, count: ratings.length }];
  }));
}

export async function publishCoordinatorRating(params: { coordinator: CoordinatorSummary; orderId: number; rating: number; reviewToken: string; secretKey: Uint8Array }): Promise<void> {
  if (!params.coordinator.nostrHexPubkey) throw new Error("Coordinator has no Nostr rating key.");
  const relay = buildNostrRelayUrl(params.coordinator);
  if (!relay) throw new Error("Coordinator has no Nostr relay.");
  const event = finalizeEvent({
    kind: RATING_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["sig", params.reviewToken], ["d", `${params.coordinator.shortAlias}:${params.orderId}`], ["p", params.coordinator.nostrHexPubkey], ["rating", String(Math.min(5, Math.max(1, params.rating)) / 5)]],
    content: ""
  }, params.secretKey);
  const pool = new SimplePool();
  try { await Promise.any(pool.publish([relay], event)); }
  finally { pool.destroy(); }
}
