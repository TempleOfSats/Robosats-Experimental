import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCoordinatorInfoMock, fetchCoordinatorLimitsMock } = vi.hoisted(() => ({
  fetchCoordinatorInfoMock: vi.fn(),
  fetchCoordinatorLimitsMock: vi.fn()
}));

vi.mock("@/domains/coordinators/coordinatorApi", () => ({
  fetchCoordinatorInfo: fetchCoordinatorInfoMock,
  fetchCoordinatorLimits: fetchCoordinatorLimitsMock
}));

import {
  buildCoordinatorSummary,
  FEDERATION_CACHE_MAX_AGE_MS,
  FEDERATION_REFRESH_MIN_INTERVAL_MS,
  useFederationStore
} from "@/domains/coordinators/federationStore";
import { defaultFederation } from "@/domains/coordinators/defaultFederation";
import type {
  CoordinatorDefinition,
  CoordinatorInfo,
  CoordinatorLimitList
} from "@/domains/coordinators/coordinator.types";

const coordinator: CoordinatorDefinition = {
  shortAlias: "lake",
  longAlias: "TheBigLake",
  identifier: "thebiglake",
  color: "#000D28",
  description: "Coordinator description",
  motto: "Economic freedom",
  established: "2023-12-30",
  federated: true,
  nostrHexPubkey: "nostr-hex",
  mainnet: {
    onion: "http://lake.onion",
    clearnet: "https://unsafe.thebiglake.org",
    i2p: ""
  },
  testnet: {
    onion: "http://test-lake.onion",
    clearnet: "https://test.unsafe.thebiglake.org",
    i2p: ""
  },
  mainnetNodesPubkeys: ["mainnet-node"],
  testnetNodesPubkeys: ["testnet-node"],
  contact: {
    email: "coordinator@example.com",
    pgp: "/static/federation/pgp/key.asc",
    fingerprint: "FINGERPRINT"
  },
  badges: {
    isFounder: true,
    donatesToDevFund: 30,
    hasGoodOpSec: true,
    hasLargeLimits: true
  },
  policies: {
    "Privacy Policy": "No third-party sharing."
  }
};

beforeEach(() => {
  fetchCoordinatorInfoMock.mockReset();
  fetchCoordinatorLimitsMock.mockReset();
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: (key: string) => storage.delete(key)
  };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", { localStorage, location: { origin: "http://client.onion" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildCoordinatorSummary", () => {
  it("contains only the current built-in federation", () => {
    expect(defaultFederation.map((item) => item.shortAlias)).not.toContain("freedomsats");
  });

  it("keeps background metadata refreshes well inside the cache lifetime", () => {
    expect(FEDERATION_REFRESH_MIN_INTERVAL_MS).toBe(10 * 60 * 1000);
    expect(FEDERATION_REFRESH_MIN_INTERVAL_MS).toBeLessThan(FEDERATION_CACHE_MAX_AGE_MS);
  });

  it("keeps full federation metadata for coordinator details", () => {
    const summary = buildCoordinatorSummary(coordinator, {
      network: "mainnet",
      origin: "clearnet",
      selfhostedClient: false
    });

    expect(summary).toMatchObject({
      shortAlias: "lake",
      longAlias: "TheBigLake",
      identifier: "thebiglake",
      federated: true,
      url: "https://unsafe.thebiglake.org",
      nostrHexPubkey: "nostr-hex",
      mainnetNodesPubkeys: ["mainnet-node"],
      testnetNodesPubkeys: ["testnet-node"],
      contact: {
        email: "coordinator@example.com",
        fingerprint: "FINGERPRINT"
      },
      policies: {
        "Privacy Policy": "No third-party sharing."
      }
    });
    expect(summary.mainnet?.onion).toBe("http://lake.onion");
    expect(summary.testnet?.clearnet).toBe("https://test.unsafe.thebiglake.org");
    expect(summary.badgeIcons.map((badge) => badge.active)).toEqual([true, true, true, true]);
  });

  it("uses the lightweight info endpoint for health and preserves cached limits", async () => {
    const summary = buildCoordinatorSummary(coordinator, {
      network: "mainnet",
      origin: "onion",
      selfhostedClient: false
    });
    const limits = {
      "1": { code: "USD", min_amount: 10, max_amount: 1_000 }
    } as unknown as CoordinatorLimitList;
    const info = {
      maker_fee: 0.002,
      taker_fee: 0.002,
      swap_enabled: false,
      notice_severity: "none",
      notice_message: ""
    } as CoordinatorInfo;
    fetchCoordinatorInfoMock.mockResolvedValue(info);
    useFederationStore.setState({
      connection: "nostr",
      coordinators: [{ ...summary, limits }],
      lastRefreshed: undefined,
      network: "mainnet",
      origin: "onion",
      refreshing: false,
      selfhostedClient: false
    });

    const refresh = useFederationStore.getState().refreshCoordinator("lake", { priority: "visible" });

    await vi.waitFor(() => expect(useFederationStore.getState().coordinators[0]?.online).toBe(true));
    expect(useFederationStore.getState().coordinators[0]).toMatchObject({
      info,
      loading: false,
      online: true
    });
    expect(useFederationStore.getState().coordinators[0]?.lastCheckedAt).toEqual(expect.any(Number));
    expect(fetchCoordinatorInfoMock).toHaveBeenCalledWith("http://lake.onion", {
      force: false,
      priority: "visible"
    });
    await refresh;
    expect(fetchCoordinatorLimitsMock).not.toHaveBeenCalled();
    expect(useFederationStore.getState().coordinators[0]?.limits).toBe(limits);
  });

  it("loads trading limits only when a selected flow asks for them", async () => {
    const summary = buildCoordinatorSummary(coordinator, {
      network: "mainnet",
      origin: "onion",
      selfhostedClient: false
    });
    const limits = {
      "1": { code: "USD", min_amount: 10, max_amount: 1_000 }
    } as unknown as CoordinatorLimitList;
    fetchCoordinatorLimitsMock.mockResolvedValue(limits);
    useFederationStore.setState({
      connection: "nostr",
      coordinators: [{ ...summary, online: true, lastCheckedAt: Date.now() }],
      lastRefreshed: Date.now(),
      network: "mainnet",
      origin: "onion",
      refreshing: false,
      selfhostedClient: false
    });

    await expect(
      useFederationStore.getState().refreshCoordinatorLimits("lake", {
        priority: "visible"
      })
    ).resolves.toBe(true);

    expect(fetchCoordinatorLimitsMock).toHaveBeenCalledWith("http://lake.onion", {
      force: undefined,
      priority: "visible"
    });
    expect(useFederationStore.getState().coordinators[0]?.limits).toBe(limits);
    expect(useFederationStore.getState().coordinators[0]?.online).toBe(true);
  });

  it("keeps a coordinator's last state and retry eligibility when refresh is cancelled", async () => {
    const previousInfo = {
      maker_fee: 0.002,
      taker_fee: 0.002,
      swap_enabled: false,
      notice_severity: "none",
      notice_message: ""
    } as CoordinatorInfo;
    const previous = {
      ...buildCoordinatorSummary(coordinator, {
        network: "mainnet",
        origin: "onion",
        selfhostedClient: false
      }),
      shortAlias: "cancelled",
      online: true,
      lastCheckedAt: 123,
      info: previousInfo
    };
    const recoveredInfo = { ...previousInfo, maker_fee: 0.003 };
    fetchCoordinatorInfoMock
      .mockRejectedValueOnce(Object.assign(new Error("App backgrounded"), { name: "AbortError" }))
      .mockResolvedValueOnce(recoveredInfo);
    useFederationStore.setState({
      connection: "nostr",
      coordinators: [previous],
      lastRefreshed: undefined,
      network: "mainnet",
      origin: "onion",
      refreshing: false,
      selfhostedClient: false
    });

    await expect(
      useFederationStore.getState().refreshCoordinator("cancelled", { force: true, priority: "visible" })
    ).resolves.toBe(false);
    expect(useFederationStore.getState().coordinators[0]).toMatchObject({
      info: previousInfo,
      lastCheckedAt: 123,
      loading: false,
      online: true
    });

    await expect(useFederationStore.getState().refreshCoordinator("cancelled", { priority: "visible" })).resolves.toBe(
      true
    );
    expect(fetchCoordinatorInfoMock).toHaveBeenCalledTimes(2);
    expect(useFederationStore.getState().coordinators[0]?.info).toBe(recoveredInfo);
  });

  it("does not cache an interrupted federation refresh as fresh", async () => {
    const previous = {
      ...buildCoordinatorSummary(coordinator, {
        network: "mainnet",
        origin: "onion",
        selfhostedClient: false
      }),
      shortAlias: "batch-cancelled",
      online: true,
      lastCheckedAt: 123,
      error: "Previous status."
    };
    fetchCoordinatorInfoMock.mockRejectedValue(Object.assign(new Error("App backgrounded"), { name: "AbortError" }));
    useFederationStore.setState({
      connection: "nostr",
      coordinators: [previous],
      lastRefreshed: 456,
      network: "mainnet",
      origin: "onion",
      refreshing: false,
      selfhostedClient: false
    });

    await useFederationStore.getState().refreshCoordinators({ force: true });

    expect(useFederationStore.getState()).toMatchObject({ lastRefreshed: 456, refreshing: false });
    expect(useFederationStore.getState().coordinators[0]).toMatchObject({
      error: "Previous status.",
      lastCheckedAt: 123,
      loading: false,
      online: true
    });
  });

  it("keeps a genuine federation result when another coordinator is cancelled", async () => {
    const base = buildCoordinatorSummary(coordinator, {
      network: "mainnet",
      origin: "onion",
      selfhostedClient: false
    });
    const successful = {
      ...base,
      shortAlias: "successful",
      mainnet: { onion: "http://successful.onion" },
      url: "http://successful.onion"
    };
    const cancelled = {
      ...base,
      shortAlias: "mixed-cancelled",
      mainnet: { onion: "http://cancelled.onion" },
      url: "http://cancelled.onion",
      online: true,
      lastCheckedAt: 123,
      error: "Previous status."
    };
    const info = {
      maker_fee: 0.002,
      taker_fee: 0.002,
      swap_enabled: false,
      notice_severity: "none",
      notice_message: ""
    } as CoordinatorInfo;
    fetchCoordinatorInfoMock.mockImplementation((url: string) =>
      url.includes("successful")
        ? Promise.resolve(info)
        : Promise.reject(Object.assign(new Error("App backgrounded"), { name: "AbortError" }))
    );
    useFederationStore.setState({
      connection: "nostr",
      coordinators: [successful, cancelled],
      lastRefreshed: undefined,
      network: "mainnet",
      origin: "onion",
      refreshing: false,
      selfhostedClient: false
    });

    await useFederationStore.getState().refreshCoordinators({ force: true });

    expect(useFederationStore.getState().lastRefreshed).toEqual(expect.any(Number));
    expect(useFederationStore.getState().coordinators).toEqual([
      expect.objectContaining({ shortAlias: "successful", info, online: true }),
      expect.objectContaining({
        shortAlias: "mixed-cancelled",
        error: "Previous status.",
        lastCheckedAt: 123,
        loading: false,
        online: true
      })
    ]);
  });

  it("does not preserve an availability result beyond the cache lifetime", async () => {
    const summary = buildCoordinatorSummary(coordinator, {
      network: "mainnet",
      origin: "onion",
      selfhostedClient: false
    });
    fetchCoordinatorInfoMock.mockRejectedValue(new Error("offline"));
    useFederationStore.setState({
      connection: "nostr",
      coordinators: [
        {
          ...summary,
          online: true,
          lastCheckedAt: Date.now() - FEDERATION_CACHE_MAX_AGE_MS - 1
        }
      ],
      lastRefreshed: undefined,
      network: "mainnet",
      origin: "onion",
      refreshing: false,
      selfhostedClient: false
    });

    await useFederationStore.getState().refreshCoordinator("lake", {
      force: true,
      priority: "visible"
    });

    expect(useFederationStore.getState().coordinators[0]?.online).toBe(false);
  });

  it("writes one combined cache snapshot after refreshing the federation", async () => {
    const summary = buildCoordinatorSummary(coordinator, {
      network: "mainnet",
      origin: "onion",
      selfhostedClient: false
    });
    const second = {
      ...summary,
      shortAlias: "temple",
      longAlias: "Temple of Sats",
      identifier: "temple",
      url: "http://temple.onion"
    };
    fetchCoordinatorInfoMock.mockResolvedValue({
      maker_fee: 0.002,
      taker_fee: 0.002,
      swap_enabled: false,
      notice_severity: "none",
      notice_message: ""
    } as CoordinatorInfo);
    useFederationStore.setState({
      connection: "nostr",
      coordinators: [summary, second],
      lastRefreshed: undefined,
      network: "mainnet",
      origin: "onion",
      refreshing: false,
      selfhostedClient: false
    });

    await useFederationStore.getState().refreshCoordinators({ force: true });

    expect(
      vi
        .mocked(globalThis.localStorage.setItem)
        .mock.calls.filter(([key]) => key === "robosats_exp_federation_cache_v1")
    ).toHaveLength(1);
  });

  it("can bypass stale health without promoting recovery probes", async () => {
    const summary = buildCoordinatorSummary(coordinator, {
      network: "mainnet",
      origin: "onion",
      selfhostedClient: false
    });
    fetchCoordinatorInfoMock.mockResolvedValue({
      maker_fee: 0.002,
      taker_fee: 0.002,
      swap_enabled: false,
      notice_severity: "none",
      notice_message: ""
    } as CoordinatorInfo);
    useFederationStore.setState({
      connection: "nostr",
      coordinators: [summary],
      lastRefreshed: Date.now(),
      network: "mainnet",
      origin: "onion",
      refreshing: false,
      selfhostedClient: false
    });

    await useFederationStore.getState().refreshCoordinators({
      force: true,
      priority: "background"
    });

    expect(fetchCoordinatorInfoMock).toHaveBeenCalledWith("http://lake.onion", {
      force: true,
      priority: "background"
    });
  });
});
