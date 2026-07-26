import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { garageSecretStore } from "@/domains/pro/garageSecretStore";
import { buildGarageRecordEvent, decodeGarageRecordEvent, garageSyncEngine } from "@/domains/pro/garageSync";
import { activeGarageEntries, decodeGarageToken, deriveGarageRobotToken, garageTokenId } from "@/domains/pro/garageVault";
import { resetGarageVaultRuntimeForTests, useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import type { GarageRobotRecord } from "@/domains/pro/garageSyncRecords";

const remoteDevice = "ffeeddccbbaa99887766554433221100";
const remoteEntry = "1234567890abcdef1234567890abcdef";

describe("Garage synchronization runtime", () => {
  const storage = new Map<string, string>();

  beforeEach(async () => {
    vi.restoreAllMocks();
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    });
    vi.spyOn(SimplePool.prototype, "subscribeMany").mockReturnValue({ close: () => undefined });
    await garageSecretStore.remove();
    resetGarageVaultRuntimeForTests();
  });

  afterEach(() => {
    garageSyncEngine.stop();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pulls a robot created by another Garage device", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const secret = decodeGarageToken(useGarageVaultStore.getState().exportToken());
    const token = deriveGarageRobotToken(secret, remoteEntry);
    const record: GarageRobotRecord = {
      type: "robot",
      version: 1,
      id: remoteEntry,
      tokenId: garageTokenId(token),
      nickname: "Remote robot",
      revision: 1,
      writerDeviceId: remoteDevice,
      updatedAt: 2
    };
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (_relays, filter) =>
      filter.authors?.includes(buildGarageRecordEvent(secret, record, 10).pubkey)
        ? [buildGarageRecordEvent(secret, record, 10)]
        : []);
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);

    await syncGarageNow([coordinator()]);

    expect(activeGarageEntries(useGarageVaultStore.getState().manifest!).map((entry) => entry.nickname))
      .toContain("Remote robot");
  });

  it("publishes a robot added while the initial pull is active", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const secret = decodeGarageToken(useGarageVaultStore.getState().exportToken());
    let resolveQuery: (events: Event[]) => void = () => undefined;
    const query = new Promise<Event[]>((resolve) => { resolveQuery = resolve; });
    vi.spyOn(SimplePool.prototype, "querySync").mockReturnValue(query);
    const published: Event[] = [];
    vi.spyOn(SimplePool.prototype, "publish").mockImplementation((_relays, event) => {
      published.push(event);
      return [Promise.resolve("accepted")];
    });

    const synchronization = syncGarageNow([coordinator()]);
    await vi.waitFor(() => expect(SimplePool.prototype.querySync).toHaveBeenCalledTimes(1));
    await useGarageVaultStore.getState().createDerivedRobot("Concurrent robot");
    resolveQuery([]);
    await synchronization;

    const decoded = published.map((event) => decodeGarageRecordEvent(event, secret)?.record)
      .find((record) => record?.type === "robot");
    expect(decoded).toMatchObject({ type: "robot", nickname: "Concurrent robot" });
  });

  it("finishes routine synchronization without waiting for a slow relay", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Fast path");
    let resolveSlow: (events: Event[]) => void = () => undefined;
    const slow = new Promise<Event[]>((resolve) => { resolveSlow = resolve; });
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (relays) =>
      relays[0]?.includes("fast.example") ? [] : slow);
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);

    await expect(syncGarageNow([
      coordinator("fast", "https://fast.example"),
      coordinator("slow", "https://slow.example")
    ])).resolves.toEqual(expect.any(Number));
    expect(SimplePool.prototype.publish).toHaveBeenCalled();
    resolveSlow([]);
  });

  it("keeps two live relay subscriptions and backs off only the failed relay", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const subscriptions: Array<{
      relay: string;
      params: { oneose?: () => void; onclose?: (reasons: string[]) => void };
    }> = [];
    vi.spyOn(SimplePool.prototype, "subscribeMany").mockImplementation((relays, _filter, params) => {
      subscriptions.push({ relay: relays[0], params });
      return { close: vi.fn() };
    });
    const coordinators = [
      coordinator("alpha", "https://alpha.example"),
      coordinator("bravo", "https://bravo.example"),
      coordinator("charlie", "https://charlie.example")
    ];

    try {
      garageSyncEngine.start(() => coordinators, false);
      expect(subscriptions).toHaveLength(2);
      const failedRelay = subscriptions[0].relay;
      const healthyRelay = subscriptions[1].relay;

      subscriptions[0].params.onclose?.(["network-error"]);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(subscriptions).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);

      expect(subscriptions.filter(({ relay }) => relay === failedRelay)).toHaveLength(2);
      expect(subscriptions.filter(({ relay }) => relay === healthyRelay)).toHaveLength(1);
    } finally {
      garageSyncEngine.stop();
      vi.useRealTimers();
    }
  });

  it("persists one relay acknowledgement until a second relay accepts", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Replicated robot");
    vi.spyOn(SimplePool.prototype, "querySync").mockResolvedValue([]);
    vi.spyOn(SimplePool.prototype, "publish").mockImplementation((relays) => [
      relays[0]?.includes("accepting.example")
        ? Promise.resolve("accepted")
        : Promise.reject(new Error("offline"))
    ]);

    await expect(syncGarageNow([
      coordinator("slow", "https://slow.example"),
      coordinator("accepting", "https://accepting.example")
    ])).resolves.toEqual(expect.any(Number));
    expect(useGarageVaultStore.getState().pendingOutbox()).toEqual(expect.arrayContaining([
      expect.objectContaining({ item: expect.objectContaining({ acceptedRelays: ["wss://accepting.example/relay/"] }) })
    ]));

    vi.spyOn(SimplePool.prototype, "publish").mockImplementation(() => [Promise.resolve("accepted")]);
    await syncGarageNow([
      coordinator("slow", "https://slow.example"),
      coordinator("accepting", "https://accepting.example")
    ], { forcePublish: true });
    expect(useGarageVaultStore.getState().pendingOutbox()).toHaveLength(0);
  });

  it("uses incremental relay cursors after the first full pull", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const filters: Array<{ since?: number }> = [];
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (_relays, filter) => {
      filters.push(filter);
      return [];
    });
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);

    await syncGarageNow([coordinator()]);
    await syncGarageNow([coordinator()]);

    expect(filters.some((filter) => filter.since === undefined)).toBe(true);
    expect(filters.some((filter) => typeof filter.since === "number")).toBe(true);
  });

  it("merges a slower relay response after the fast path completes", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const secret = decodeGarageToken(useGarageVaultStore.getState().exportToken());
    const token = deriveGarageRobotToken(secret, remoteEntry);
    const record: GarageRobotRecord = {
      type: "robot",
      version: 1,
      id: remoteEntry,
      tokenId: garageTokenId(token),
      nickname: "Background robot",
      revision: 1,
      writerDeviceId: remoteDevice,
      updatedAt: 2
    };
    let resolveSlow: (events: Event[]) => void = () => undefined;
    const slow = new Promise<Event[]>((resolve) => { resolveSlow = resolve; });
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (relays) =>
      relays[0]?.includes("fast.example") ? [] : slow);
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);

    await syncGarageNow([
      coordinator("fast", "https://fast.example"),
      coordinator("slow", "https://slow.example")
    ]);
    resolveSlow([buildGarageRecordEvent(secret, record, 10)]);

    await vi.waitFor(() => expect(activeGarageEntries(useGarageVaultStore.getState().manifest!)
      .map((entry) => entry.nickname)).toContain("Background robot"));
  });

  it("waits for all responsive pulls during an explicit synchronization", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    let resolveSlow: (events: Event[]) => void = () => undefined;
    const slow = new Promise<Event[]>((resolve) => { resolveSlow = resolve; });
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (relays) =>
      relays[0]?.includes("fast.example") ? [] : slow);
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);
    let finished = false;

    const synchronization = syncGarageNow([
      coordinator("fast", "https://fast.example"),
      coordinator("slow", "https://slow.example")
    ], { forcePublish: true }).then(() => { finished = true; });
    await vi.waitFor(() => expect(SimplePool.prototype.querySync).toHaveBeenCalled());
    await Promise.resolve();
    expect(finished).toBe(false);
    resolveSlow([]);
    await synchronization;
    expect(finished).toBe(true);
  });
});

function coordinator(shortAlias = "test", url = "https://example.com"): CoordinatorSummary {
  return {
    avatarUrl: "",
    badgeIcons: [],
    color: "#000000",
    enabled: true,
    longAlias: shortAlias,
    online: true,
    shortAlias,
    smallAvatarUrl: "",
    url
  };
}

function syncGarageNow(coordinators: CoordinatorSummary[], options: { forcePublish?: boolean } = {}): Promise<number> {
  garageSyncEngine.start(() => coordinators, false);
  return garageSyncEngine.synchronize(options);
}
