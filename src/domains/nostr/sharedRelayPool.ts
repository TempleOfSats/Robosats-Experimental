import { SimplePool } from "nostr-tools/pool";
import {
  LiveRelaySubscriptionManager,
  type LiveRelaySubscriptions
} from "@/domains/nostr/liveRelaySubscriptions";

export const RELAY_CONNECTION_TIMEOUT_MS = 120_000;

const sharedRelayPool = new SimplePool({
  // Coordinator relays already send WebSocket pings. nostr-tools' browser
  // fallback uses a short-lived Nostr REQ that can close healthy Tor sockets.
  enablePing: false,
  enableReconnect: false
});
sharedRelayPool.maxWaitForConnection = RELAY_CONNECTION_TIMEOUT_MS;
const liveRelaySubscriptions = new LiveRelaySubscriptionManager(sharedRelayPool);

const relayQueries = new Map<string, Promise<void>>();

export function getSharedRelayPool(): SimplePool {
  return sharedRelayPool;
}

export function getLiveRelaySubscriptions(): LiveRelaySubscriptions {
  return liveRelaySubscriptions;
}

// Queries reuse the live WebSocket and are serialized per relay, while the
// multiplexer keeps persistent consumers inside a single concurrent REQ.
export async function withRelayQueryPool<T>(query: (pool: SimplePool) => Promise<T>): Promise<T> {
  return query(sharedRelayPool);
}

export function runRelayQuery<T>(relay: string, query: () => Promise<T>): Promise<T> {
  const previous = relayQueries.get(relay) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(query);
  const settled = result.then(() => undefined, () => undefined);
  relayQueries.set(relay, settled);
  void settled.finally(() => {
    if (relayQueries.get(relay) === settled) relayQueries.delete(relay);
  });
  return result;
}

export function resetLiveRelaySubscriptionsForTests(): void {
  liveRelaySubscriptions.reset();
}
