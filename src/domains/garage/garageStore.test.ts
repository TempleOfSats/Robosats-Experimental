import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { getRobotAuthForCoordinator, selectCurrentSlot, selectFleetManagedSlots, selectStandardGarageSlots, type RobotSlot, useGarageStore } from "@/domains/garage/garageStore";

let storage: Map<string, string>;

const fetchRobotMock = vi.hoisted(() => vi.fn());

vi.mock("@/domains/garage/robotApi", () => ({
  fetchRobot: fetchRobotMock
}));

beforeEach(() => {
  storage = new Map();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", {
    localStorage,
    crypto: globalThis.crypto
  });
  fetchRobotMock.mockReset();
  useGarageStore.setState({ slots: [], currentToken: undefined, hydrated: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const slot: RobotSlot = {
  token: "token",
  hashId: "hash",
  tokenSHA256: "slot-token",
  nostrPubKey: "nostr",
  nostrSecKey: new Uint8Array(),
  entropyBits: 100,
  hasEnoughEntropy: true,
  shannonEntropy: 4,
  nickname: "Robot",
  earnedRewards: 0,
  robots: {
    local: {
      token: "token",
      tokenSHA256: "local-token",
      shortAlias: "local"
    },
    lake: {
      token: "token",
      tokenSHA256: "lake-token",
      shortAlias: "lake",
      pubKey: "pub",
      encPrivKey: "priv",
      nostrPubKey: "lake-nostr"
    }
  }
};

describe("garage selectors", () => {
  it("selects the current slot or falls back to the first slot", () => {
    expect(selectCurrentSlot([slot], "token")).toBe(slot);
    expect(selectCurrentSlot([slot], "missing")).toBe(slot);
  });

  it("keeps Fleet-managed identities out of the standard Garage projection", () => {
    const fleetSlot = { ...makeSlot("fleet"), managedBy: "fleet" as const };
    expect(selectStandardGarageSlots([fleetSlot, slot])).toEqual([slot]);
    expect(selectFleetManagedSlots([fleetSlot, slot])).toEqual([fleetSlot]);
  });

  it("builds auth for the requested coordinator robot", () => {
    expect(getRobotAuthForCoordinator(slot, "lake")).toEqual({
      tokenSHA256: "lake-token",
      nostrPubkey: "lake-nostr",
      keys: {
        pubKey: "pub",
        encPrivKey: "priv"
      }
    });
  });

  it("falls back to token-only auth when PGP keys are unavailable", () => {
    expect(getRobotAuthForCoordinator(slot, "local")).toEqual({ tokenSHA256: "local-token" });
  });
});

describe("garage order sync", () => {
  it("hydrates stored robots before adding a new one", () => {
    storage.set("robosats_exp_garage_slots_v1", JSON.stringify({
      format: "robosats-exp-garage-slots",
      version: 1,
      slots: [
        { token: "alpha", nickname: "Alpha", robots: {} },
        { token: "beta", nickname: "Beta", robots: {} }
      ]
    }));

    useGarageStore.getState().addSlot(makeSlot("gamma"));

    expect(useGarageStore.getState().slots.map((item) => item.token)).toEqual(["alpha", "beta", "gamma"]);
    expect(JSON.parse(storage.get("robosats_exp_garage_slots_v1") ?? "{}")).toMatchObject({
      format: "robosats-exp-garage-slots",
      version: 1,
      slots: [
        { token: "alpha" },
        { token: "beta" },
        { token: "gamma" }
      ]
    });
  });

  it("keeps Fleet identities in memory without duplicating their secrets into web storage", () => {
    const standard = makeSlot("standard");
    const fleet = { ...makeSlot("fleet"), managedBy: "fleet" as const };
    useGarageStore.setState({ slots: [standard], currentToken: standard.token, hydrated: true });
    useGarageStore.getState().addSlot(fleet);

    expect(useGarageStore.getState().slots).toHaveLength(2);
    expect(useGarageStore.getState().currentToken).toBe(fleet.token);
    expect(storage.get("robosats_exp_garage_slots_v1")).not.toContain(fleet.token);
    expect(storage.get("robosats_exp_garage_current_slot")).toBe(standard.token);
  });

  it("removes previously persisted Fleet identities while hydrating web storage", () => {
    storage.set("robosats_exp_garage_slots_v1", JSON.stringify({
      format: "robosats-exp-garage-slots",
      version: 1,
      slots: [
        { token: "standard", nickname: "Standard", robots: {} },
        { token: "fleet", nickname: "Fleet", managedBy: "fleet", robots: { local: { token: "fleet" } } }
      ]
    }));
    storage.set("robosats_exp_garage_current_slot", "fleet");

    useGarageStore.getState().hydrate();

    expect(useGarageStore.getState().slots).toMatchObject([{ token: "standard" }]);
    expect(useGarageStore.getState().currentToken).toBe("standard");
    expect(storage.get("robosats_exp_garage_slots_v1")).not.toContain('"fleet"');
    expect(storage.get("robosats_exp_garage_current_slot")).toBe("standard");
  });

  it("does not persist transient robot refresh flags", () => {
    const loadingSlot = {
      ...makeSlot("loading"),
      loading: true,
      robots: {
        local: {
          ...makeSlot("loading").robots.local,
          loading: true
        }
      }
    };
    useGarageStore.setState({ slots: [], currentToken: undefined, hydrated: true });
    useGarageStore.getState().addSlot(loadingSlot);

    const stored = JSON.parse(storage.get("robosats_exp_garage_slots_v1") ?? "{}");
    expect(stored.slots[0]).not.toHaveProperty("loading");
    expect(stored.slots[0].robots.local).not.toHaveProperty("loading");

    useGarageStore.setState({ slots: [], currentToken: undefined, hydrated: false });
    useGarageStore.getState().hydrate();
    expect(useGarageStore.getState().slots[0].loading).toBeUndefined();
    expect(useGarageStore.getState().slots[0].robots.local.loading).toBeUndefined();
  });

  it("replaces an existing slot with a newly added local robot for the same token", () => {
    const existingSlot = makeSlot("token");
    useGarageStore.setState({
      slots: [
        {
          ...existingSlot,
          activeOrderId: 89895,
          lastOrderId: 89890,
          robots: {
            ...existingSlot.robots,
            lake: {
              token: "token",
              tokenSHA256: "lake-sha",
              shortAlias: "lake",
              activeOrderId: 89895,
              lastOrderId: 89890
            }
          }
        }
      ],
      currentToken: "token",
      hydrated: true
    });

    useGarageStore.getState().addSlot({
      ...makeSlot("token"),
      nickname: "Fresh Robot",
      robots: {
        local: {
          token: "token",
          tokenSHA256: "fresh-sha",
          shortAlias: "local",
          pubKey: "fresh-pub",
          encPrivKey: "fresh-priv",
          nostrPubKey: "fresh-nostr"
        }
      }
    });

    const slots = useGarageStore.getState().slots;
    expect(slots).toHaveLength(1);
    expect(slots[0].nickname).toBe("Fresh Robot");
    expect(slots[0].robots.local.tokenSHA256).toBe("fresh-sha");
    expect(slots[0].activeOrderId).toBe(89895);
    expect(slots[0].lastOrderId).toBe(89890);
    expect(slots[0].robots.lake.activeOrderId).toBe(89895);
    expect(useGarageStore.getState().currentToken).toBe("token");
  });

  it("stores fetched non-terminal orders as active for the coordinator robot", () => {
    useGarageStore.setState({ slots: [makeSlot("token")], currentToken: "token", hydrated: true });

    useGarageStore.getState().syncOrderSnapshot({ token: "token", shortAlias: "lake", orderId: 89895, status: 9 });

    const synced = useGarageStore.getState().slots[0];
    expect(synced.activeOrderId).toBe(89895);
    expect(synced.lastOrderId).toBe(89895);
    expect(synced.robots.lake.activeOrderId).toBe(89895);
    expect(synced.robots.lake.lastOrderId).toBe(89895);
  });

  it("keeps a taken order active when the trade screen is left before bonding", () => {
    useGarageStore.setState({ slots: [makeSlot("token")], currentToken: "token", hydrated: true });

    useGarageStore.getState().setActiveOrder("token", "lake", 89895);

    const stored = useGarageStore.getState().slots[0];
    expect(stored.activeOrderId).toBe(89895);
    expect(stored.robots.lake.activeOrderId).toBe(89895);
  });

  it("detaches a released take from active and recent orders", () => {
    useGarageStore.setState({ slots: [makeSlot("token")], currentToken: "token", hydrated: true });
    useGarageStore.getState().setActiveOrder("token", "lake", 89895);

    useGarageStore.getState().releaseOrderReservation("token", "lake", 89895);

    const released = useGarageStore.getState().slots[0];
    expect(released.activeOrderId).toBeUndefined();
    expect(released.lastOrderId).toBeUndefined();
    expect(released.robots.lake.releasedOrderId).toBe(89895);
  });

  it("detaches an unpaid taker reservation after it returns to the public book", () => {
    useGarageStore.setState({ slots: [makeSlot("token")], currentToken: "token", hydrated: true });
    useGarageStore.getState().setActiveOrder("token", "lake", 89895);

    useGarageStore.getState().syncOrderSnapshot({
      token: "token",
      shortAlias: "lake",
      orderId: 89895,
      status: 1,
      isMaker: false
    });
    useGarageStore.getState().releaseOrderReservation("token", "lake", 89895);

    const released = useGarageStore.getState().slots[0];
    expect(released.activeOrderId).toBeUndefined();
    expect(released.lastOrderId).toBeUndefined();
    expect(released.robots.lake.activeOrderId).toBeUndefined();
    expect(released.robots.lake.lastOrderId).toBeUndefined();
    expect(released.robots.lake.releasedOrderId).toBe(89895);
  });

  it("clears the release marker when the same order is taken again", () => {
    useGarageStore.setState({ slots: [makeSlot("token")], currentToken: "token", hydrated: true });
    useGarageStore.getState().setActiveOrder("token", "lake", 89895);
    useGarageStore.getState().releaseOrderReservation("token", "lake", 89895);

    useGarageStore.getState().setActiveOrder("token", "lake", 89895);

    const retaken = useGarageStore.getState().slots[0];
    expect(retaken.activeOrderId).toBe(89895);
    expect(retaken.robots.lake.releasedOrderId).toBeUndefined();
  });

  it("moves terminal fetched orders from active to last order", () => {
    useGarageStore.setState({ slots: [makeSlot("token")], currentToken: "token", hydrated: true });

    useGarageStore.getState().syncOrderSnapshot({ token: "token", shortAlias: "lake", orderId: 89895, status: 14 });

    const synced = useGarageStore.getState().slots[0];
    expect(synced.activeOrderId).toBeUndefined();
    expect(synced.lastOrderId).toBe(89895);
    expect(synced.robots.lake.activeOrderId).toBeUndefined();
    expect(synced.robots.lake.lastOrderId).toBe(89895);
    expect(storage.get("robosats_exp_garage_current_slot")).toBe("token");
  });

  it("releases a seller as soon as payout routing becomes buyer-only", () => {
    useGarageStore.setState({ slots: [makeSlot("token")], currentToken: "token", hydrated: true });
    useGarageStore.getState().setActiveOrder("token", "lake", 89895);

    useGarageStore.getState().syncOrderSnapshot({
      token: "token",
      shortAlias: "lake",
      orderId: 89895,
      status: 13,
      isMaker: true,
      isSeller: true
    });

    const synced = useGarageStore.getState().slots[0];
    expect(synced.activeOrderId).toBeUndefined();
    expect(synced.lastOrderId).toBe(89895);
  });

  it("keeps routing status for buyers and completes it for sellers without relying on optional metadata", () => {
    useGarageStore.setState({ slots: [makeSlot("token")], currentToken: "token", hydrated: true });
    useGarageStore.getState().syncOrderSnapshot({
      token: "token",
      shortAlias: "lake",
      orderId: 89895,
      status: 15,
      isSeller: true
    });
    expect(useGarageStore.getState().slots[0].activeOrderId).toBeUndefined();

    useGarageStore.getState().syncOrderSnapshot({
      token: "token",
      shortAlias: "lake",
      orderId: 89896,
      status: 15,
      isSeller: false
    });
    expect(useGarageStore.getState().slots[0].activeOrderId).toBe(89896);
  });

  it("keeps an expired maker order active so it can be renewed", () => {
    useGarageStore.setState({ slots: [makeSlot("token")], currentToken: "token", hydrated: true });

    useGarageStore.getState().syncOrderSnapshot({
      token: "token",
      shortAlias: "lake",
      orderId: 89895,
      status: 5,
      isMaker: true
    });

    const synced = useGarageStore.getState().slots[0];
    expect(synced.activeOrderId).toBe(89895);
    expect(synced.lastOrderId).toBe(89895);
    expect(synced.robots.lake.activeOrderId).toBe(89895);
    expect(synced.robots.lake.renewableOrderId).toBe(89895);
  });

  it("moves an expired taker order to the last-order history", () => {
    useGarageStore.setState({ slots: [makeSlot("token")], currentToken: "token", hydrated: true });

    useGarageStore.getState().syncOrderSnapshot({
      token: "token",
      shortAlias: "lake",
      orderId: 89895,
      status: 5,
      isMaker: false
    });

    const synced = useGarageStore.getState().slots[0];
    expect(synced.activeOrderId).toBeUndefined();
    expect(synced.lastOrderId).toBe(89895);
    expect(synced.robots.lake.renewableOrderId).toBeUndefined();
  });

  it("updates and persists a coordinator's stealth invoice preference", () => {
    useGarageStore.setState({ slots: [slot], currentToken: "token", hydrated: true });

    useGarageStore.getState().setStealthInvoices("token", "lake", false);

    expect(useGarageStore.getState().slots[0].robots.lake.stealthInvoices).toBe(false);
    expect(storage.get("robosats_exp_garage_slots_v1")).toContain('"stealthInvoices":false');
  });

  it("keeps the locally active order when a robot refresh fails", async () => {
    const activeSlot = slotWithCoordinatorKeys({ activeOrderId: 89895, lastOrderId: 89895 });
    useGarageStore.setState({ slots: [activeSlot], currentToken: "token", hydrated: true });
    fetchRobotMock.mockRejectedValue(new Error("Network unavailable"));

    await useGarageStore.getState().refreshRobots([coordinator]);

    const refreshed = useGarageStore.getState().slots[0];
    expect(refreshed.activeOrderId).toBe(89895);
    expect(refreshed.robots.lake.activeOrderId).toBe(89895);
    expect(refreshed.robots.lake.error).toBeTruthy();
  });

  it("moves an active order to the latest order from a successful robot snapshot", async () => {
    const activeSlot = slotWithCoordinatorKeys({ activeOrderId: 89895, lastOrderId: 89895 });
    useGarageStore.setState({ slots: [activeSlot], currentToken: "token", hydrated: true });
    fetchRobotMock.mockResolvedValue(robotSnapshot({ lastOrderId: 89895 }));

    await useGarageStore.getState().refreshRobots([coordinator]);

    const refreshed = useGarageStore.getState().slots[0];
    expect(refreshed.activeOrderId).toBeUndefined();
    expect(refreshed.lastOrderId).toBe(89895);
    expect(refreshed.robots.lake.activeOrderId).toBeUndefined();
  });

  it("preserves a renewable expired order when the coordinator reports it as the last order", async () => {
    const renewableSlot = slotWithCoordinatorKeys({
      activeOrderId: 89895,
      lastOrderId: 89895,
      renewableOrderId: 89895
    });
    useGarageStore.setState({ slots: [renewableSlot], currentToken: "token", hydrated: true });
    fetchRobotMock.mockResolvedValue(robotSnapshot({ lastOrderId: 89895 }));

    await useGarageStore.getState().refreshRobots([coordinator]);

    const refreshed = useGarageStore.getState().slots[0];
    expect(refreshed.activeOrderId).toBe(89895);
    expect(refreshed.lastOrderId).toBe(89895);
    expect(refreshed.robots.lake.activeOrderId).toBe(89895);
    expect(refreshed.robots.lake.renewableOrderId).toBe(89895);
  });

  it("keeps the coordinator's canonical keys for an existing robot", async () => {
    useGarageStore.setState({ slots: [slotWithCoordinatorKeys()], currentToken: "token", hydrated: true });
    fetchRobotMock.mockResolvedValue(robotSnapshot({ pubKey: "coordinator-pub", encPrivKey: "coordinator-priv" }));

    await useGarageStore.getState().refreshRobots([coordinator]);

    const robot = useGarageStore.getState().slots[0].robots.lake;
    expect(robot.pubKey).toBe("coordinator-pub");
    expect(robot.encPrivKey).toBe("coordinator-priv");
  });

  it("refreshes an explicit slot without changing the selected robot", async () => {
    const alpha = { ...slotWithCoordinatorKeys(), token: "alpha", tokenSHA256: "slot-alpha", nickname: "Alpha" };
    const beta = { ...slotWithCoordinatorKeys(), token: "beta", tokenSHA256: "slot-beta", nickname: "Beta" };
    useGarageStore.setState({ slots: [alpha, beta], currentToken: "alpha", hydrated: true });
    fetchRobotMock.mockResolvedValue(robotSnapshot({ activeOrderId: 91234, lastOrderId: 91234 }));

    const result = await useGarageStore.getState().refreshRobotSlot("beta", [coordinator]);

    expect(useGarageStore.getState().currentToken).toBe("alpha");
    expect(useGarageStore.getState().slots[0].activeOrderId).toBeUndefined();
    expect(useGarageStore.getState().slots[1].activeOrderId).toBe(91234);
    expect(result).toMatchObject({
      slotId: "slot-beta",
      coordinators: [{ shortAlias: "lake", activeOrderId: 91234, lastOrderId: 91234 }]
    });
  }, 30000);

  it("shares a robot refresh across foreground and background callers", async () => {
    useGarageStore.setState({ slots: [slotWithCoordinatorKeys()], currentToken: "token", hydrated: true });
    let resolveRobot: ((snapshot: ReturnType<typeof robotSnapshot>) => void) | undefined;
    fetchRobotMock.mockReturnValue(new Promise((resolve) => {
      resolveRobot = resolve;
    }));

    const background = useGarageStore.getState().refreshRobotSlot("token", [coordinator], {
      priority: "background"
    });
    await vi.waitFor(() => expect(fetchRobotMock).toHaveBeenCalledOnce());
    const foreground = useGarageStore.getState().refreshRobotSlot("token", [coordinator], {
      priority: "foreground"
    });
    resolveRobot?.(robotSnapshot());
    await Promise.all([background, foreground]);

    expect(fetchRobotMock).toHaveBeenCalledOnce();
  }, 30000);

  it("reuses a recent successful robot result for background reconciliation", async () => {
    const checkedAt = Date.now() - 10_000;
    const freshSlot = slotWithCoordinatorKeys({ activeOrderId: 91234, lastOrderId: 91234 });
    freshSlot.robots.lake.lastCheckedAt = checkedAt;
    useGarageStore.setState({ slots: [freshSlot], currentToken: "token", hydrated: true });
    const observer = vi.fn();

    const result = await useGarageStore.getState().refreshRobotSlot("token", [coordinator], {
      maxAgeMs: 300_000,
      onCoordinatorResult: observer,
      priority: "background"
    });

    expect(fetchRobotMock).not.toHaveBeenCalled();
    expect(result.coordinators).toEqual([expect.objectContaining({
      shortAlias: "lake",
      cached: true,
      activeOrderId: 91234,
      lastOrderId: 91234
    })]);
    expect(observer).toHaveBeenCalledOnce();
    expect(useGarageStore.getState().slots[0].loading).toBeFalsy();
  });

  it("bypasses robot freshness when no maximum age is requested", async () => {
    const freshSlot = slotWithCoordinatorKeys();
    freshSlot.robots.lake.lastCheckedAt = Date.now();
    useGarageStore.setState({ slots: [freshSlot], currentToken: "token", hydrated: true });
    fetchRobotMock.mockResolvedValue(robotSnapshot());

    await useGarageStore.getState().refreshRobotSlot("token", [coordinator], {
      priority: "foreground"
    });

    expect(fetchRobotMock).toHaveBeenCalledOnce();
  });

  it("does not let a foreground refresh join a partial cached background run", async () => {
    const temple = {
      ...coordinator,
      shortAlias: "temple",
      longAlias: "Temple",
      url: "https://temple.example"
    };
    const freshSlot = slotWithCoordinatorKeys();
    freshSlot.robots.lake.lastCheckedAt = Date.now();
    useGarageStore.setState({ slots: [freshSlot], currentToken: "token", hydrated: true });
    const resolvers: Array<(value: ReturnType<typeof robotSnapshot>) => void> = [];
    fetchRobotMock.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));

    const background = useGarageStore.getState().refreshRobotSlot(
      "token",
      [coordinator, temple],
      { maxAgeMs: 300_000, priority: "background" }
    );
    await vi.waitFor(() => expect(fetchRobotMock).toHaveBeenCalledTimes(1));

    const foreground = useGarageStore.getState().refreshRobotSlot(
      "token",
      [coordinator, temple],
      { priority: "foreground" }
    );
    await vi.waitFor(() => expect(fetchRobotMock).toHaveBeenCalledTimes(3));
    resolvers.forEach((resolve) => resolve(robotSnapshot()));
    await Promise.all([background, foreground]);
  });

  it("applies a preferred coordinator before slower refreshes settle", async () => {
    const temple = {
      ...coordinator,
      shortAlias: "temple",
      longAlias: "Temple",
      url: "https://temple.example"
    };
    useGarageStore.setState({ slots: [slotWithCoordinatorKeys()], currentToken: "token", hydrated: true });
    let resolveLake: ((value: ReturnType<typeof robotSnapshot>) => void) | undefined;
    let resolveTemple: ((value: ReturnType<typeof robotSnapshot>) => void) | undefined;
    fetchRobotMock.mockImplementation((url: string) => new Promise((resolve) => {
      if (url.includes("temple")) resolveTemple = resolve;
      else resolveLake = resolve;
    }));

    const refresh = useGarageStore.getState().refreshRobotSlot("token", [temple, coordinator], {
      preferredAliases: ["lake"]
    });
    await vi.waitFor(() => expect(fetchRobotMock).toHaveBeenCalledTimes(2));
    resolveLake?.(robotSnapshot({ activeOrderId: 91234, lastOrderId: 91234 }));
    await vi.waitFor(() => expect(useGarageStore.getState().slots[0].robots.lake.activeOrderId).toBe(91234));
    expect(useGarageStore.getState().slots[0].loading).toBe(true);

    resolveTemple?.(robotSnapshot());
    await refresh;
    expect(useGarageStore.getState().slots[0].loading).toBe(false);
  }, 30000);

  it("notifies observers as each coordinator settles", async () => {
    const temple = {
      ...coordinator,
      shortAlias: "temple",
      longAlias: "Temple",
      url: "https://temple.example"
    };
    useGarageStore.setState({ slots: [slotWithCoordinatorKeys()], currentToken: "token", hydrated: true });
    let resolveLake: ((value: ReturnType<typeof robotSnapshot>) => void) | undefined;
    let resolveTemple: ((value: ReturnType<typeof robotSnapshot>) => void) | undefined;
    fetchRobotMock.mockImplementation((url: string) => new Promise((resolve) => {
      if (url.includes("temple")) resolveTemple = resolve;
      else resolveLake = resolve;
    }));
    const observer = vi.fn();

    const refresh = useGarageStore.getState().refreshRobotSlot("token", [temple, coordinator], {
      onCoordinatorResult: observer,
      preferredAliases: ["lake"]
    });
    await vi.waitFor(() => expect(fetchRobotMock).toHaveBeenCalledTimes(2));
    resolveLake?.(robotSnapshot({ activeOrderId: 91234, lastOrderId: 91234 }));

    await vi.waitFor(() => expect(observer).toHaveBeenCalledWith(expect.objectContaining({
      shortAlias: "lake",
      activeOrderId: 91234,
      transportFailed: false
    })));
    expect(observer).toHaveBeenCalledTimes(1);

    resolveTemple?.(robotSnapshot());
    await refresh;
    expect(observer).toHaveBeenCalledTimes(2);
  }, 30000);

  it("does not resurrect a released reservation from a stale robot snapshot", async () => {
    const activeSlot = slotWithCoordinatorKeys({ activeOrderId: 89895, lastOrderId: 89895 });
    useGarageStore.setState({ slots: [activeSlot], currentToken: "token", hydrated: true });
    useGarageStore.getState().releaseOrderReservation("token", "lake", 89895);
    fetchRobotMock.mockResolvedValue(robotSnapshot({ activeOrderId: 89895, lastOrderId: 89895 }));

    await useGarageStore.getState().refreshRobots([coordinator]);

    const refreshed = useGarageStore.getState().slots[0];
    expect(refreshed.activeOrderId).toBeUndefined();
    expect(refreshed.lastOrderId).toBeUndefined();
    expect(refreshed.robots.lake.releasedOrderId).toBe(89895);
  }, 30000);

  it("does not resurrect a reservation released while its robot refresh is in flight", async () => {
    const activeSlot = slotWithCoordinatorKeys({ activeOrderId: 89895, lastOrderId: 89895 });
    useGarageStore.setState({ slots: [activeSlot], currentToken: "token", hydrated: true });
    let resolveRobot: ((snapshot: ReturnType<typeof robotSnapshot>) => void) | undefined;
    fetchRobotMock.mockReturnValue(new Promise((resolve) => {
      resolveRobot = resolve;
    }));

    const refresh = useGarageStore.getState().refreshRobots([coordinator]);
    await vi.waitFor(() => expect(fetchRobotMock).toHaveBeenCalledOnce());
    useGarageStore.getState().releaseOrderReservation("token", "lake", 89895);
    resolveRobot?.(robotSnapshot({ activeOrderId: 89895, lastOrderId: 89895 }));
    await refresh;

    const refreshed = useGarageStore.getState().slots[0];
    expect(refreshed.activeOrderId).toBeUndefined();
    expect(refreshed.lastOrderId).toBeUndefined();
    expect(refreshed.robots.lake.releasedOrderId).toBe(89895);
  }, 30000);

  it("does not clear a new reservation created while its robot refresh is in flight", async () => {
    useGarageStore.setState({ slots: [slotWithCoordinatorKeys()], currentToken: "token", hydrated: true });
    let resolveRobot: ((snapshot: ReturnType<typeof robotSnapshot>) => void) | undefined;
    fetchRobotMock.mockReturnValue(new Promise((resolve) => {
      resolveRobot = resolve;
    }));

    const refresh = useGarageStore.getState().refreshRobots([coordinator]);
    await vi.waitFor(() => expect(fetchRobotMock).toHaveBeenCalledOnce());
    useGarageStore.getState().setActiveOrder("token", "lake", 91234);
    resolveRobot?.(robotSnapshot());
    await refresh;

    const refreshed = useGarageStore.getState().slots[0];
    expect(refreshed.activeOrderId).toBe(91234);
    expect(refreshed.lastOrderId).toBe(91234);
    expect(refreshed.robots.lake.activeOrderId).toBe(91234);
  }, 30000);

  it("replaces incompatible keys with a coordinator-compatible pair", async () => {
    const oldSlot = slotWithCoordinatorKeys();
    oldSlot.robots.lake.pubKey = "x".repeat(889);
    oldSlot.robots.lake.encPrivKey = "x".repeat(1114);
    useGarageStore.setState({ slots: [oldSlot], currentToken: "token", hydrated: true });
    fetchRobotMock.mockImplementation(async (_url, auth) => {
      expect(auth.keys?.pubKey).not.toBe(oldSlot.robots.lake.pubKey);
      expect(auth.keys?.encPrivKey).not.toBe(oldSlot.robots.lake.encPrivKey);
      return robotSnapshot({ pubKey: auth.keys?.pubKey, encPrivKey: auth.keys?.encPrivKey });
    });

    await useGarageStore.getState().refreshRobots([coordinator]);

    expect(useGarageStore.getState().slots[0].robots.lake.error).toBeUndefined();
  }, 30000);
});

const coordinator = {
  shortAlias: "lake",
  longAlias: "TheBigLake",
  color: "#000000",
  url: "https://coordinator.example",
  avatarUrl: "/lake.webp",
  smallAvatarUrl: "/lake.small.webp",
  badgeIcons: [],
  enabled: true,
  online: true
} satisfies CoordinatorSummary;

function slotWithCoordinatorKeys(
  order: { activeOrderId?: number; lastOrderId?: number; renewableOrderId?: number } = {}
): RobotSlot {
  return {
    ...slot,
    activeOrderId: order.activeOrderId,
    lastOrderId: order.lastOrderId,
    robots: {
      lake: {
        token: "token",
        tokenSHA256: "lake-token",
        shortAlias: "lake",
        pubKey: "public-key",
        encPrivKey: "private-key",
        nostrPubKey: "lake-nostr",
        ...order
      }
    }
  };
}

function robotSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    nickname: "Robot",
    hashId: "hash",
    earnedRewards: 0,
    stealthInvoices: true,
    found: true,
    tgEnabled: false,
    webhookEnabled: false,
    ...overrides
  };
}

function makeSlot(token: string): RobotSlot {
  return {
    ...slot,
    token,
    hashId: `hash-${token}`,
    nickname: `Robot ${token}`,
    tokenSHA256: `sha-${token}`,
    robots: {
      local: {
        token,
        tokenSHA256: `sha-${token}`,
        shortAlias: "local"
      }
    }
  };
}
