import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

const fetchCoordinatorBook = vi.hoisted(() => vi.fn());

vi.mock("@/domains/coordinators/coordinatorApi", () => ({
  fetchCoordinatorBook
}));

import { useOrderbookStore } from "@/domains/orderbook/orderbookStore";

describe("orderbook store reliability", () => {
  beforeEach(() => {
    fetchCoordinatorBook.mockReset();
    useOrderbookStore.setState({
      orders: [],
      loading: false,
      refreshing: false,
      cacheState: "none",
      error: undefined,
      lastUpdated: undefined,
      sourceConnection: undefined,
      sourceNetwork: undefined,
      sourceOrigin: undefined
    });
  });

  it("does not erase confirmed offers when a live Nostr snapshot is partial", () => {
    const confirmed = order(1, "lake");
    useOrderbookStore.setState({
      orders: [confirmed],
      sourceConnection: "nostr",
      sourceNetwork: "mainnet",
      sourceOrigin: "onion"
    });

    useOrderbookStore.getState().applyLiveOrders([], "nostr", "mainnet", "onion", true);

    expect(useOrderbookStore.getState().orders).toEqual([confirmed]);
    expect(useOrderbookStore.getState().refreshing).toBe(true);

    useOrderbookStore.getState().applyLiveOrders([], "nostr", "mainnet", "onion", false);
    expect(useOrderbookStore.getState().orders).toEqual([]);
  });

  it("retains an unreachable coordinator's offers when another API refresh succeeds", async () => {
    const lake = coordinator("lake", "https://lake.example");
    const temple = coordinator("temple", "https://temple.example");
    const staleLakeOrder = order(1, "lake");
    const retainedTempleOrder = order(2, "temple");
    const freshLakeOrder = order(3, "lake");
    useOrderbookStore.setState({
      orders: [staleLakeOrder, retainedTempleOrder],
      sourceConnection: "api",
      sourceNetwork: "mainnet",
      sourceOrigin: "onion"
    });
    fetchCoordinatorBook.mockImplementation(async (url: string) => {
      if (url === lake.url) return [freshLakeOrder];
      throw new Error("temporary Tor circuit failure");
    });

    await useOrderbookStore.getState().refreshOrderbook([lake, temple], {
      connection: "api",
      force: true,
      network: "mainnet",
      origin: "onion"
    });

    expect(useOrderbookStore.getState().orders).toEqual(
      expect.arrayContaining([freshLakeOrder, retainedTempleOrder])
    );
    expect(useOrderbookStore.getState().orders).not.toContain(staleLakeOrder);
  });
});

function coordinator(shortAlias: string, url: string): CoordinatorSummary {
  return {
    shortAlias,
    longAlias: shortAlias,
    color: "#111111",
    url,
    avatarUrl: "",
    smallAvatarUrl: "",
    badgeIcons: [],
    enabled: true,
    online: true
  };
}

function order(id: number, coordinatorShortAlias: string): PublicOrder {
  return {
    id,
    type: 0,
    currency: 1,
    currencyCode: "USD",
    amount: 100,
    has_range: false,
    is_swap: false,
    min_amount: 100,
    max_amount: 100,
    payment_method: "Zelle",
    premium: 0,
    satoshis: 10_000,
    maker_nick: "MakerRobot",
    maker_hash_id: `maker-${id}`,
    bond_size_sats: 300,
    coordinatorShortAlias
  };
}
