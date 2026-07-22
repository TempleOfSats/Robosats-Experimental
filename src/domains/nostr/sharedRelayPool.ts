import { SimplePool } from "nostr-tools/pool";

const sharedRelayPool = new SimplePool({
  enablePing: true,
  enableReconnect: true
});

const relayQueries = new Map<string, Promise<void>>();

export function getSharedRelayPool(): SimplePool {
  return sharedRelayPool;
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
