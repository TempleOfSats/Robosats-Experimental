import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import {
  clearOrderbookCache,
  isFreshOrderbookCache,
  ORDERBOOK_CACHE_MAX_AGE_MS,
  ORDERBOOK_CACHE_STALE_MAX_AGE_MS,
  readOrderbookCache,
  readStaleOrderbookCache,
  writeOrderbookCache
} from "@/domains/orderbook/orderbookCache";

const now = 1_800_000_000_000;
const orders = [
  {
    id: 1,
    created_at: "2026-07-08T00:00:00.000Z",
    type: 0,
    currency: 1,
    currencyCode: "USD",
    amount: 20,
    has_range: false,
    is_swap: false,
    min_amount: 20,
    max_amount: 20,
    payment_method: "Zelle",
    premium: 0,
    satoshis: 1000,
    maker_nick: "MakerRobot",
    maker_hash_id: "maker-hash",
    bond_size_sats: 30,
    coordinatorShortAlias: "lake"
  }
] satisfies PublicOrder[];

describe("orderbook cache", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      }
    });
  });

  afterEach(() => {
    clearOrderbookCache();
    vi.unstubAllGlobals();
  });

  it("reads fresh cache for the same connection, network, and origin", () => {
    writeOrderbookCache("nostr", "mainnet", "onion", orders, now);

    expect(readOrderbookCache("nostr", "mainnet", "onion", now + 1000)?.orders).toEqual(orders);
  });

  it("rejects cache older than 30 minutes", () => {
    writeOrderbookCache("nostr", "mainnet", "onion", orders, now);

    expect(readOrderbookCache("nostr", "mainnet", "onion", now + ORDERBOOK_CACHE_MAX_AGE_MS + 1)).toBeNull();
  });

  it("uses a stale snapshot while reconnecting for up to 24 hours", () => {
    writeOrderbookCache("nostr", "mainnet", "onion", orders, now);

    const staleAt = now + ORDERBOOK_CACHE_MAX_AGE_MS + 1;
    expect(readOrderbookCache("nostr", "mainnet", "onion", staleAt)).toBeNull();
    expect(readStaleOrderbookCache("nostr", "mainnet", "onion", staleAt)?.orders).toEqual(orders);
    expect(readStaleOrderbookCache("nostr", "mainnet", "onion", now + ORDERBOOK_CACHE_STALE_MAX_AGE_MS + 1)).toBeNull();
  });

  it("rejects wrong network or connection", () => {
    writeOrderbookCache("nostr", "mainnet", "onion", orders, now);

    expect(readOrderbookCache("nostr", "testnet", "onion", now)).toBeNull();
    expect(readOrderbookCache("api", "mainnet", "onion", now)).toBeNull();
    expect(readOrderbookCache("nostr", "mainnet", "clearnet", now)).toBeNull();
  });

  it("accepts cache exactly at the freshness limit", () => {
    expect(isFreshOrderbookCache(now, now + ORDERBOOK_CACHE_MAX_AGE_MS)).toBe(true);
  });
});
