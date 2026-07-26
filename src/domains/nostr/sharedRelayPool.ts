import { SimplePool } from "nostr-tools/pool";

export const RELAY_CONNECTION_TIMEOUT_MS = 120_000;

const sharedRelayPool = new SimplePool({
  enablePing: true,
  enableReconnect: false
});
sharedRelayPool.maxWaitForConnection = RELAY_CONNECTION_TIMEOUT_MS;

const relayQueries = new Map<string, Promise<void>>();

export function getSharedRelayPool(): SimplePool {
  return sharedRelayPool;
}

// Query callers share the same physical relay connections as live subscriptions.
// The callback wrapper remains to keep existing call sites and query semantics stable.
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
