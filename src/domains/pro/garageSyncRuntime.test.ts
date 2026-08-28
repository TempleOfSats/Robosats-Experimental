import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Filter } from "nostr-tools/filter";
import { getPublicKey, type Event } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { resetLiveRelaySubscriptionsForTests } from "@/domains/nostr/sharedRelayPool";
import { verifyGarageBackup } from "@/domains/pro/garageBackupVerification";
import { deriveGarageDomainKey } from "@/domains/pro/garageCrypto";
import { garageSecretStore } from "@/domains/pro/garageSecretStore";
import {
  buildGarageRecordEvent,
  decodeGarageRecordEvent,
  garageSyncEngine,
  invalidateGarageSyncCursors
} from "@/domains/pro/garageSync";
import {
  activeGarageEntries,
  decodeGarageToken,
  deriveGarageRobotToken,
  encodeGarageToken,
  garageTokenId
} from "@/domains/pro/garageVault";
import { resetGarageVaultRuntimeForTests, useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import {
  GARAGE_SYNC_LIMITS,
  preferencesToSyncRecord,
  presetToSyncRecord,
  type GarageRobotRecord
} from "@/domains/pro/garageSyncRecords";
import { createPortableSettingsManifest, saveOfferPreset } from "@/domains/pro/portableSettings";
import { FakeIndexedDb } from "@/test/fakeIndexedDb";

const remoteDevice = "ffeeddccbbaa99887766554433221100";
const remoteEntry = "1234567890abcdef1234567890abcdef";

type DirectQueryParams = {
  onclose?: (reason: string) => void;
  oneose?: () => void;
  onevent?: (event: Event) => void;
};

describe("Garage synchronization runtime", () => {
  const storage = new Map<string, string>();

  beforeEach(async () => {
    vi.restoreAllMocks();
    storage.clear();
    vi.stubGlobal("indexedDB", new FakeIndexedDb().factory);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    });
    resetLiveRelaySubscriptionsForTests();
    vi.spyOn(SimplePool.prototype, "subscribeMap").mockReturnValue({ close: () => undefined });
    installDirectQueryAdapter();
    await garageSecretStore.remove();
    resetGarageVaultRuntimeForTests();
  });

  afterEach(() => {
    garageSyncEngine.stop();
    resetLiveRelaySubscriptionsForTests();
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
        : []
    );
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);

    await syncGarageNow([coordinator()]);

    expect(activeGarageEntries(useGarageVaultStore.getState().manifest!).map((entry) => entry.nickname)).toContain(
      "Remote robot"
    );
  });

  it("publishes a robot added while the initial pull is active", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const secret = decodeGarageToken(useGarageVaultStore.getState().exportToken());
    let resolveQuery: (events: Event[]) => void = () => undefined;
    const query = new Promise<Event[]>((resolve) => {
      resolveQuery = resolve;
    });
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

    const decoded = published
      .map((event) => decodeGarageRecordEvent(event, secret)?.record)
      .find((record) => record?.type === "robot");
    expect(decoded).toMatchObject({ type: "robot", nickname: "Concurrent robot" });
  });

  it("finishes routine synchronization without waiting for a slow relay", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Fast path");
    let resolveSlow: (events: Event[]) => void = () => undefined;
    const slow = new Promise<Event[]>((resolve) => {
      resolveSlow = resolve;
    });
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (relays) =>
      relays[0]?.includes("fast.example") ? [] : slow
    );
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);

    await expect(
      syncGarageNow([coordinator("fast", "https://fast.example"), coordinator("slow", "https://slow.example")])
    ).resolves.toEqual(expect.any(Number));
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
    vi.spyOn(SimplePool.prototype, "subscribeMap").mockImplementation((requests, params) => {
      subscriptions.push({ relay: requests[0].url, params });
      return { close: vi.fn() };
    });
    const coordinators = [
      coordinator("alpha", "https://alpha.example"),
      coordinator("bravo", "https://bravo.example"),
      coordinator("charlie", "https://charlie.example")
    ];

    try {
      garageSyncEngine.start(() => coordinators, false);
      await vi.advanceTimersByTimeAsync(50);
      expect(subscriptions).toHaveLength(2);
      const failedRelay = subscriptions[0].relay;
      const healthyRelay = subscriptions[1].relay;

      subscriptions[0].params.onclose?.(["network-error"]);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(subscriptions).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(50);

      expect(subscriptions.filter(({ relay }) => relay === failedRelay)).toHaveLength(2);
      expect(subscriptions.filter(({ relay }) => relay === healthyRelay)).toHaveLength(1);
    } finally {
      garageSyncEngine.stop();
      vi.useRealTimers();
    }
  });

  it("rotates live relay subscriptions when the active Fleet changes", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    vi.useFakeTimers();
    const physical: Array<{ authors: string[]; close: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(SimplePool.prototype, "subscribeMap").mockImplementation((requests) => {
      const close = vi.fn();
      physical.push({
        authors: requests.flatMap(({ filter }) => filter.authors ?? []),
        close
      });
      return { close };
    });
    const coordinators = [coordinator()];

    try {
      garageSyncEngine.start(() => coordinators, false);
      await vi.advanceTimersByTimeAsync(50);
      expect(physical).toHaveLength(1);

      const nextSecret = new Uint8Array(32).fill(7);
      await useGarageVaultStore.getState().restore(encodeGarageToken(nextSecret));
      garageSyncEngine.start(() => coordinators, false);
      await vi.advanceTimersByTimeAsync(50);

      expect(physical).toHaveLength(2);
      expect(physical[0].close).toHaveBeenCalledOnce();
      expect(physical[1].authors).not.toEqual(physical[0].authors);
      expect(physical[1].authors).toEqual(
        (["garage-sync", "settings-sync", "history-sync"] as const).map((domain) =>
          getPublicKey(deriveGarageDomainKey(nextSecret, domain))
        )
      );
    } finally {
      garageSyncEngine.stop();
      vi.useRealTimers();
    }
  });

  it("rotates live subscriptions and ignores old events after a same-key offline restore", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    const manifest = useGarageVaultStore.getState().manifest!;
    const remoteEntry = "f".repeat(32);
    const staleRecord: GarageRobotRecord = {
      type: "robot",
      version: 1,
      id: remoteEntry,
      tokenId: garageTokenId(deriveGarageRobotToken(secret, remoteEntry)),
      nickname: "Stale subscription robot",
      revision: 1,
      writerDeviceId: remoteDevice,
      updatedAt: 2
    };
    const physical: Array<{
      close: ReturnType<typeof vi.fn>;
      params: { onevent?: (event: Event) => void };
    }> = [];
    vi.spyOn(SimplePool.prototype, "querySync").mockResolvedValue([]);
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);
    vi.spyOn(SimplePool.prototype, "subscribeMap").mockImplementation((_requests, params) => {
      const close = vi.fn();
      physical.push({ close, params });
      return { close };
    });
    const coordinators = [coordinator()];

    try {
      garageSyncEngine.start(() => coordinators, false);
      await vi.waitFor(() => expect(physical).toHaveLength(1));

      invalidateGarageSyncCursors(secret);
      await useGarageVaultStore.getState().restoreRobotManifest(fleetKey, manifest);
      garageSyncEngine.start(() => coordinators);
      await vi.waitFor(() => expect(physical).toHaveLength(2));
      expect(physical[0].close).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(SimplePool.prototype.querySync).toHaveBeenCalled());

      physical[0].params.onevent?.(buildGarageRecordEvent(secret, staleRecord, 10));
      expect(
        activeGarageEntries(useGarageVaultStore.getState().manifest!).map(({ nickname }) => nickname)
      ).not.toContain("Stale subscription robot");
    } finally {
      garageSyncEngine.stop();
    }
  });

  it("persists one relay acknowledgement until a second relay accepts", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Replicated robot");
    vi.spyOn(SimplePool.prototype, "querySync").mockResolvedValue([]);
    vi.spyOn(SimplePool.prototype, "publish").mockImplementation((relays) => [
      relays[0]?.includes("accepting.example") ? Promise.resolve("accepted") : Promise.reject(new Error("offline"))
    ]);

    await expect(
      syncGarageNow([
        coordinator("slow", "https://slow.example"),
        coordinator("accepting", "https://accepting.example")
      ])
    ).resolves.toEqual(expect.any(Number));
    expect(useGarageVaultStore.getState().pendingOutbox()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({ acceptedRelays: ["wss://accepting.example/relay/"] })
        })
      ])
    );

    vi.spyOn(SimplePool.prototype, "publish").mockImplementation(() => [Promise.resolve("accepted")]);
    await syncGarageNow(
      [coordinator("slow", "https://slow.example"), coordinator("accepting", "https://accepting.example")],
      { forcePublish: true }
    );
    expect(useGarageVaultStore.getState().pendingOutbox()).toHaveLength(0);
  });

  it("keeps backup verification pending until the complete Fleet can be read from two relays", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Verified robot");
    const relayEvents = new Map<string, Event[]>();
    let secondRelayAvailable = false;
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (relays) => {
      const relay = relays[0] ?? "";
      if (relay.includes("second.example") && !secondRelayAvailable) throw new Error("offline");
      return relayEvents.get(relay) ?? [];
    });
    vi.spyOn(SimplePool.prototype, "publish").mockImplementation((relays, event) => {
      const relay = relays[0] ?? "";
      if (relay.includes("second.example") && !secondRelayAvailable) {
        return [Promise.reject(new Error("offline"))];
      }
      relayEvents.set(relay, [...(relayEvents.get(relay) ?? []), event]);
      return [Promise.resolve("accepted")];
    });
    const coordinators = [
      coordinator("first", "https://first.example"),
      coordinator("second", "https://second.example")
    ];
    garageSyncEngine.start(() => coordinators, false);
    await expect(verifyGarageBackup(coordinators)).resolves.toMatchObject({
      requiredRelays: 2,
      verified: false,
      verifiedRelays: 1
    });
    expect(useGarageVaultStore.getState().pendingOutbox().length).toBeGreaterThan(0);

    secondRelayAvailable = true;
    await expect(verifyGarageBackup(coordinators)).resolves.toMatchObject({
      requiredRelays: 2,
      verified: true,
      verifiedRelays: 2
    });
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

  it("forces a full relay pull after an offline robot restore", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    const manifest = useGarageVaultStore.getState().manifest!;
    const remoteSettings = saveOfferPreset(
      createPortableSettingsManifest(remoteDevice, { theme: "dark" }, 1),
      {
        id: "d".repeat(32),
        name: "Offline recovery preset",
        direction: 0,
        isSwap: false,
        currency: "EUR",
        amount: "100",
        paymentMethods: ["SEPA"],
        premium: 1,
        bond: 3,
        publicDuration: 86_400,
        escrowDuration: 10_800,
        description: "",
        password: ""
      },
      2
    );
    const remoteEvent = buildGarageRecordEvent(secret, presetToSyncRecord(remoteSettings.presets[0]), 10);
    let restoring = false;
    const filters: Array<{ authors?: string[]; since?: number }> = [];
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (_relays, filter) => {
      filters.push(filter);
      if (restoring && filter.since === undefined && filter.authors?.includes(remoteEvent.pubkey)) {
        return [remoteEvent];
      }
      return [];
    });
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);

    await syncGarageNow([coordinator()]);
    restoring = true;
    invalidateGarageSyncCursors(secret);
    await useGarageVaultStore.getState().restoreRobotManifest(fleetKey, manifest);
    filters.length = 0;
    await syncGarageNow([coordinator()]);

    expect(filters[0]?.since).toBeUndefined();
    expect(useGarageVaultStore.getState().envelope?.settings.presets).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Offline recovery preset" })])
    );
  });

  it("publishes restored robots only to relays that completed the full reconciliation", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Offline restore robot");
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    const manifest = useGarageVaultStore.getState().manifest!;
    const publishedRobotRelays: string[] = [];
    const unreadableFilters: Array<{ since?: number }> = [];
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (relays, filter) => {
      if (!relays[0]?.includes("unreadable.example")) return [];
      unreadableFilters.push(filter);
      throw new Error("relay read failed");
    });
    vi.spyOn(SimplePool.prototype, "publish").mockImplementation((relays, event) => {
      if (decodeGarageRecordEvent(event, secret)?.record.type === "robot") {
        publishedRobotRelays.push(relays[0] ?? "");
      }
      return [Promise.resolve("accepted")];
    });

    invalidateGarageSyncCursors(secret);
    await useGarageVaultStore.getState().restoreRobotManifest(fleetKey, manifest);
    await syncGarageNow([
      coordinator("healthy", "https://healthy.example"),
      coordinator("unreadable", "https://unreadable.example")
    ]);

    expect(unreadableFilters.map(({ since }) => since)).toEqual([undefined]);
    expect(publishedRobotRelays.some((relay) => relay.includes("healthy.example"))).toBe(true);
    expect(publishedRobotRelays.some((relay) => relay.includes("unreadable.example"))).toBe(false);
  });

  it("does not publish restored robots to a relay whose full reconciliation reaches its deadline", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Offline restore robot");
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    const manifest = useGarageVaultStore.getState().manifest!;
    const publishedRobotRelays: string[] = [];
    const incompletePage = Array.from({ length: GARAGE_SYNC_LIMITS.queryPageRecords }, (_, index): Event => ({
      content: "",
      created_at: GARAGE_SYNC_LIMITS.queryPageRecords - index,
      id: index.toString(16).padStart(64, "0"),
      kind: 1,
      pubkey: "0".repeat(64),
      sig: "0".repeat(128),
      tags: []
    }));
    let incompleteQueries = 0;
    const incompleteFilters: Array<{ since?: number }> = [];
    vi.spyOn(SimplePool.prototype, "ensureRelay").mockImplementation(async (relay) => {
      return {
        subscribe: (filters: Filter[], params: DirectQueryParams) => {
          let closed = false;
          const close = () => {
            if (closed) return;
            closed = true;
            params.onclose?.("closed by test query");
          };
          queueMicrotask(() => {
            if (closed) return;
            if (relay.includes("incomplete.example")) {
              incompleteQueries += 1;
              incompleteFilters.push(filters[0]!);
              incompletePage.forEach((event) => params.onevent?.(event));
              closed = true;
              params.onclose?.("relay closed before EOSE");
            } else {
              params.oneose?.();
            }
          });
          return { close };
        }
      } as never;
    });
    vi.spyOn(SimplePool.prototype, "publish").mockImplementation((relays, event) => {
      if (decodeGarageRecordEvent(event, secret)?.record.type === "robot") {
        publishedRobotRelays.push(relays[0] ?? "");
      }
      return [Promise.resolve("accepted")];
    });

    invalidateGarageSyncCursors(secret);
    await useGarageVaultStore.getState().restoreRobotManifest(fleetKey, manifest);
    await syncGarageNow([
      coordinator("healthy", "https://healthy.example"),
      coordinator("incomplete", "https://incomplete.example")
    ]);

    expect(incompleteQueries).toBe(1);
    expect(incompleteFilters.map(({ since }) => since)).toEqual([undefined]);
    expect(publishedRobotRelays.some((relay) => relay.includes("healthy.example"))).toBe(true);
    expect(publishedRobotRelays.some((relay) => relay.includes("incomplete.example"))).toBe(false);
  });

  it("does not treat an empty query from a disconnected relay as a complete full pull", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Connection-close restore robot");
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    const manifest = useGarageVaultStore.getState().manifest!;
    const coordinators = [
      coordinator("healthy", "https://healthy.example"),
      coordinator("closed", "https://closed-before-eose.example")
    ];
    const publishedRobotRelays: string[] = [];
    vi.spyOn(SimplePool.prototype, "ensureRelay").mockImplementation(
      async (relay) =>
        ({
          subscribe: (_filters: Filter[], params: DirectQueryParams) => {
            let closed = false;
            const close = () => {
              if (closed) return;
              closed = true;
              params.onclose?.("closed by test query");
            };
            queueMicrotask(() => {
              if (closed) return;
              if (relay.includes("closed-before-eose.example")) {
                closed = true;
                params.onclose?.("relay closed before EOSE");
              } else {
                params.oneose?.();
              }
            });
            return { close };
          }
        }) as never
    );
    vi.spyOn(SimplePool.prototype, "publish").mockImplementation((relays, event) => {
      if (decodeGarageRecordEvent(event, secret)?.record.type === "robot") {
        publishedRobotRelays.push(relays[0] ?? "");
      }
      return [Promise.resolve("accepted")];
    });

    invalidateGarageSyncCursors(secret);
    await useGarageVaultStore.getState().restoreRobotManifest(fleetKey, manifest);
    await syncGarageNow(coordinators);

    expect(publishedRobotRelays.some((relay) => relay.includes("healthy.example"))).toBe(true);
    expect(publishedRobotRelays.some((relay) => relay.includes("closed-before-eose.example"))).toBe(false);
  });

  it("keeps an unreadable relay gated after restored records reach quorum", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Restored quorum robot");
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    const manifest = useGarageVaultStore.getState().manifest!;
    type Phase = "restore" | "still-unreadable" | "reconcile-third" | "third-eligible";
    let phase: Phase = "restore";
    let thirdReadable = false;
    const thirdReads: Array<{ phase: Phase; since?: number }> = [];
    const publications: Array<{ nickname: string; phase: Phase; relay: string }> = [];
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (relays, filter) => {
      if (!relays[0]?.includes("third.example")) return [];
      thirdReads.push({ phase, since: filter.since });
      if (!thirdReadable) throw new Error("third relay read failed");
      return [];
    });
    vi.spyOn(SimplePool.prototype, "publish").mockImplementation((relays, event) => {
      const record = decodeGarageRecordEvent(event, secret)?.record;
      if (record?.type === "robot") {
        publications.push({ nickname: record.nickname, phase, relay: relays[0] ?? "" });
      }
      return [Promise.resolve("accepted")];
    });
    const coordinators = [
      coordinator("first", "https://first.example"),
      coordinator("second", "https://second.example"),
      coordinator("third", "https://third.example")
    ];
    const wasPublishedTo = (expectedPhase: Phase, nickname: string, hostname: string) =>
      publications.some(
        (publication) =>
          publication.phase === expectedPhase &&
          publication.nickname === nickname &&
          publication.relay.includes(hostname)
      );

    invalidateGarageSyncCursors(secret);
    await useGarageVaultStore.getState().restoreRobotManifest(fleetKey, manifest);
    await syncGarageNow(coordinators, { awaitReplication: true });

    expect(useGarageVaultStore.getState().pendingOutbox()).toHaveLength(0);
    expect(wasPublishedTo("restore", "Restored quorum robot", "first.example")).toBe(true);
    expect(wasPublishedTo("restore", "Restored quorum robot", "second.example")).toBe(true);
    expect(wasPublishedTo("restore", "Restored quorum robot", "third.example")).toBe(false);

    phase = "still-unreadable";
    await useGarageVaultStore.getState().createDerivedRobot("Guarded new robot");
    await syncGarageNow(coordinators, { awaitReplication: true, forcePublish: true });

    expect(wasPublishedTo("still-unreadable", "Guarded new robot", "first.example")).toBe(true);
    expect(wasPublishedTo("still-unreadable", "Guarded new robot", "second.example")).toBe(true);
    expect(wasPublishedTo("still-unreadable", "Guarded new robot", "third.example")).toBe(false);
    expect(thirdReads).toContainEqual({ phase: "still-unreadable", since: undefined });

    phase = "reconcile-third";
    thirdReadable = true;
    await syncGarageNow(coordinators, { awaitReplication: true, forcePublish: true });
    expect(thirdReads).toContainEqual({ phase: "reconcile-third", since: undefined });

    phase = "third-eligible";
    await useGarageVaultStore.getState().createDerivedRobot("Post-reconciliation robot");
    await syncGarageNow(coordinators, { awaitReplication: true, forcePublish: true });
    expect(wasPublishedTo("third-eligible", "Post-reconciliation robot", "third.example")).toBe(true);
  }, 15_000);

  it("preserves the full pull requirement while a same-key restore is being installed", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    const manifest = useGarageVaultStore.getState().manifest!;
    const remoteSettings = saveOfferPreset(
      createPortableSettingsManifest(remoteDevice, { theme: "dark" }, 1),
      {
        id: "e".repeat(32),
        name: "Older relay preset",
        direction: 0,
        isSwap: false,
        currency: "EUR",
        amount: "75",
        paymentMethods: ["SEPA"],
        premium: 1,
        bond: 3,
        publicDuration: 86_400,
        escrowDuration: 10_800,
        description: "",
        password: ""
      },
      2
    );
    const remoteEvent = buildGarageRecordEvent(secret, presetToSyncRecord(remoteSettings.presets[0]), 10);
    type RestorePhase = "initial" | "install-gap" | "post-install";
    let phase: RestorePhase = "initial";
    const filters: Array<{ phase: RestorePhase; since?: number }> = [];
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (_relays, filter) => {
      filters.push({ phase, since: filter.since });
      if (phase === "post-install" && filter.since === undefined && filter.authors?.includes(remoteEvent.pubkey)) {
        return [remoteEvent];
      }
      return [];
    });
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);

    await syncGarageNow([coordinator()]);
    filters.length = 0;

    let releaseInstall: () => void = () => undefined;
    const installGate = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    const saveSecret = garageSecretStore.save.bind(garageSecretStore);
    let installReachedSecureStorage = false;
    vi.spyOn(garageSecretStore, "save").mockImplementation(async (value) => {
      installReachedSecureStorage = true;
      await installGate;
      await saveSecret(value);
    });

    invalidateGarageSyncCursors(secret);
    const restore = useGarageVaultStore.getState().restoreRobotManifest(fleetKey, manifest);
    await vi.waitFor(() => expect(installReachedSecureStorage).toBe(true));

    phase = "install-gap";
    await garageSyncEngine.synchronize();
    expect(filters).toEqual([expect.objectContaining({ phase: "install-gap", since: undefined })]);

    releaseInstall();
    await restore;
    phase = "post-install";
    await garageSyncEngine.synchronize();

    expect(filters.some(({ phase, since }) => phase === "post-install" && since === undefined)).toBe(true);
    expect(useGarageVaultStore.getState().envelope?.settings.presets).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Older relay preset" })])
    );
  });

  it("does not let a stale same-key pull recreate an invalidated cursor", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    const manifest = useGarageVaultStore.getState().manifest!;
    let resolveStalePull: (events: Event[]) => void = () => undefined;
    const stalePull = new Promise<Event[]>((resolve) => {
      resolveStalePull = resolve;
    });
    const filters: Array<{ since?: number }> = [];
    let pullCount = 0;
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (_relays, filter) => {
      filters.push(filter);
      pullCount += 1;
      if (pullCount === 1) return stalePull;
      return [];
    });
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);

    const staleSynchronization = syncGarageNow([coordinator()]);
    await vi.waitFor(() => expect(filters).toHaveLength(1));
    expect(filters[0]?.since).toBeUndefined();

    invalidateGarageSyncCursors(secret);
    await useGarageVaultStore.getState().restoreRobotManifest(fleetKey, manifest);
    const replacementSynchronization = garageSyncEngine.synchronize();
    resolveStalePull([]);

    await Promise.all([staleSynchronization, replacementSynchronization]);
    expect(filters.slice(1).some(({ since }) => since === undefined)).toBe(true);
  });

  it("does not apply a stale same-key publication acknowledgement to the restored outbox", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const robot = await useGarageVaultStore.getState().createDerivedRobot("Restored robot");
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    const manifest = useGarageVaultStore.getState().manifest!;
    let restored = false;
    let resolveStaleAcknowledgement: (value: string) => void = () => undefined;
    let resolveReplacementAcknowledgement: (value: string) => void = () => undefined;
    let replacementRobotPublished = false;
    const staleAcknowledgement = new Promise<string>((resolve) => {
      resolveStaleAcknowledgement = resolve;
    });
    const replacementAcknowledgement = new Promise<string>((resolve) => {
      resolveReplacementAcknowledgement = resolve;
    });
    vi.spyOn(SimplePool.prototype, "querySync").mockResolvedValue([]);
    vi.spyOn(SimplePool.prototype, "publish").mockImplementation((_relays, event) => {
      const record = decodeGarageRecordEvent(event, secret)?.record;
      if (record?.type !== "robot") return [Promise.resolve("accepted")];
      if (!restored) return [staleAcknowledgement];
      replacementRobotPublished = true;
      return [replacementAcknowledgement];
    });

    const staleSynchronization = syncGarageNow([coordinator()]);
    await vi.waitFor(() => expect(SimplePool.prototype.publish).toHaveBeenCalled());
    restored = true;
    invalidateGarageSyncCursors(secret);
    await useGarageVaultStore.getState().restoreRobotManifest(fleetKey, manifest);
    const replacementSynchronization = garageSyncEngine.synchronize();

    resolveStaleAcknowledgement("accepted");
    await vi.waitFor(() => expect(replacementRobotPublished).toBe(true));
    const pendingRobot = useGarageVaultStore
      .getState()
      .pendingOutbox()
      .find(({ record }) => record.type === "robot" && record.tokenId === garageTokenId(robot.token));
    expect(pendingRobot?.item.acceptedRelays).toEqual([]);

    resolveReplacementAcknowledgement("accepted");
    await Promise.all([staleSynchronization, replacementSynchronization]);
    expect(useGarageVaultStore.getState().pendingOutbox()).toHaveLength(0);
  });

  it("ignores a rejected old-key pull and continues with the replacement Fleet", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const previousSecret = decodeGarageToken(useGarageVaultStore.getState().exportToken());
    const previousGarageAuthor = getPublicKey(deriveGarageDomainKey(previousSecret, "garage-sync"));
    const nextSecret = new Uint8Array(32).fill(7);
    const nextFleetKey = encodeGarageToken(nextSecret);
    let rejectStalePull: (reason: Error) => void = () => undefined;
    const stalePull = new Promise<Event[]>((_resolve, reject) => {
      rejectStalePull = reject;
    });
    let replacementPulls = 0;
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (_relays, filter) => {
      if (filter.authors?.includes(previousGarageAuthor)) return stalePull;
      replacementPulls += 1;
      return [];
    });
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);

    const staleSynchronization = syncGarageNow([coordinator()]);
    await vi.waitFor(() => expect(SimplePool.prototype.querySync).toHaveBeenCalledTimes(1));
    await useGarageVaultStore.getState().restore(nextFleetKey);
    garageSyncEngine.start(() => [coordinator()], false);
    const replacementSynchronization = garageSyncEngine.synchronize();

    rejectStalePull(new Error("old Fleet relay disconnected"));
    await expect(Promise.all([staleSynchronization, replacementSynchronization])).resolves.toBeDefined();
    expect(replacementPulls).toBeGreaterThan(0);
    expect(useGarageVaultStore.getState().exportToken()).toBe(nextFleetKey);
    expect(useGarageVaultStore.getState().syncStatus).toBe("up-to-date");
  });

  it("does not publish a provisional preference before a slower relay answers", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    await useGarageVaultStore.getState().restoreRobotManifest(fleetKey, useGarageVaultStore.getState().manifest!);
    const localTheme = useGarageVaultStore.getState().envelope!.settings.theme.value;
    const remoteTheme = localTheme === "dark" ? "light" : "dark";
    const remotePreference = preferencesToSyncRecord(
      createPortableSettingsManifest(remoteDevice, { theme: remoteTheme }, 1)
    );
    const remoteEvent = buildGarageRecordEvent(secret, remotePreference, 10);
    let resolveSlow: (events: Event[]) => void = () => undefined;
    const slow = new Promise<Event[]>((resolve) => {
      resolveSlow = resolve;
    });
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (relays) =>
      relays[0]?.includes("fast.example") ? [] : slow
    );
    const published: Event[] = [];
    vi.spyOn(SimplePool.prototype, "publish").mockImplementation((_relays, event) => {
      published.push(event);
      return [Promise.resolve("accepted")];
    });

    await syncGarageNow([coordinator("fast", "https://fast.example"), coordinator("slow", "https://slow.example")]);
    expect(published.map((event) => decodeGarageRecordEvent(event, secret)?.record.type)).not.toContain("preferences");

    resolveSlow([remoteEvent]);
    await vi.waitFor(() => expect(useGarageVaultStore.getState().envelope?.settings.theme.value).toBe(remoteTheme));
    const publishedPreferences = published.flatMap((event) => {
      const record = decodeGarageRecordEvent(event, secret)?.record;
      return record?.type === "preferences" ? [record] : [];
    });
    expect(publishedPreferences.every(({ theme }) => theme === remoteTheme)).toBe(true);
  });

  it("does not force-publish provisional preferences after an offline robot restore", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Offline restore robot");
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    const manifest = useGarageVaultStore.getState().manifest!;
    await useGarageVaultStore.getState().restoreRobotManifest(fleetKey, manifest);
    vi.spyOn(SimplePool.prototype, "querySync").mockResolvedValue([]);
    const published: Event[] = [];
    vi.spyOn(SimplePool.prototype, "publish").mockImplementation((_relays, event) => {
      published.push(event);
      return [Promise.resolve("accepted")];
    });

    await syncGarageNow([coordinator()], { forcePublish: true });

    expect(published.map((event) => decodeGarageRecordEvent(event, secret)?.record.type)).toEqual(["robot"]);
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
    const slow = new Promise<Event[]>((resolve) => {
      resolveSlow = resolve;
    });
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (relays) =>
      relays[0]?.includes("fast.example") ? [] : slow
    );
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);

    await syncGarageNow([coordinator("fast", "https://fast.example"), coordinator("slow", "https://slow.example")]);
    resolveSlow([buildGarageRecordEvent(secret, record, 10)]);

    await vi.waitFor(() =>
      expect(activeGarageEntries(useGarageVaultStore.getState().manifest!).map((entry) => entry.nickname)).toContain(
        "Background robot"
      )
    );
  });

  it("waits for all responsive pulls during an explicit synchronization", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    let resolveSlow: (events: Event[]) => void = () => undefined;
    const slow = new Promise<Event[]>((resolve) => {
      resolveSlow = resolve;
    });
    vi.spyOn(SimplePool.prototype, "querySync").mockImplementation(async (relays) =>
      relays[0]?.includes("fast.example") ? [] : slow
    );
    vi.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("accepted")]);
    let finished = false;

    const synchronization = syncGarageNow(
      [coordinator("fast", "https://fast.example"), coordinator("slow", "https://slow.example")],
      { forcePublish: true }
    ).then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(SimplePool.prototype.querySync).toHaveBeenCalled());
    await Promise.resolve();
    expect(finished).toBe(false);
    resolveSlow([]);
    await synchronization;
    expect(finished).toBe(true);
  });

  it("keeps a restored Fleet gated across a process restart until every target relay completes a full pull", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Restart restored robot");
    const fleetKey = useGarageVaultStore.getState().exportToken();
    const secret = decodeGarageToken(fleetKey);
    const manifest = useGarageVaultStore.getState().manifest!;

    invalidateGarageSyncCursors(secret);
    await useGarageVaultStore.getState().restoreRobotManifest(fleetKey, manifest);
    const persistedBarrier = useGarageVaultStore.getState().envelope?.restoreReconciliation;
    expect(persistedBarrier).toMatchObject({
      reconciledRelays: [],
      targetRelays: []
    });
    garageSyncEngine.stop();

    vi.resetModules();
    const restartedSecretStore = await import("@/domains/pro/garageSecretStore");
    await restartedSecretStore.garageSecretStore.save(fleetKey);
    const restartedVault = await import("@/domains/pro/garageVaultStore");
    await restartedVault.useGarageVaultStore.getState().initialize();
    expect(restartedVault.useGarageVaultStore.getState().envelope?.restoreReconciliation).toEqual(persistedBarrier);
    await restartedVault.useGarageVaultStore.getState().createDerivedRobot("Restart queued robot");
    const restartedSync = await import("@/domains/pro/garageSync");
    const restartedEngine = restartedSync.garageSyncEngine as unknown as { pool: SimplePool };
    installDirectQueryAdapterOn(restartedEngine.pool);
    const coordinators = [coordinator("fast", "https://fast.example"), coordinator("slow", "https://slow.example")];
    let resolveSlowPull: (events: Event[]) => void = () => undefined;
    const slowPull = new Promise<Event[]>((resolve) => {
      resolveSlowPull = resolve;
    });
    let slowFullPullComplete = false;
    const slowFilters: Array<{ since?: number }> = [];
    const publications: Array<{ afterFullPull: boolean; nickname: string; relay: string }> = [];
    vi.spyOn(restartedEngine.pool, "querySync").mockImplementation(async (relays, filter) => {
      if (!relays[0]?.includes("slow.example")) return [];
      slowFilters.push(filter);
      return slowPull;
    });
    vi.spyOn(restartedEngine.pool, "publish").mockImplementation((relays, event) => {
      const record = restartedSync.decodeGarageRecordEvent(event, secret)?.record;
      if (record?.type === "robot") {
        publications.push({
          afterFullPull: slowFullPullComplete,
          nickname: record.nickname,
          relay: relays[0] ?? ""
        });
      }
      return [Promise.resolve("accepted")];
    });

    try {
      restartedSync.garageSyncEngine.start(() => coordinators, false);
      const synchronization = restartedSync.garageSyncEngine.synchronize();
      await vi.waitFor(() => expect(slowFilters).toHaveLength(1));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      slowFullPullComplete = true;
      resolveSlowPull([]);
      await synchronization;
      await vi.waitFor(() =>
        expect(
          publications.some(
            ({ nickname, relay }) => nickname === "Restart queued robot" && relay.includes("slow.example")
          )
        ).toBe(true)
      );

      const slowPublications = publications.filter(
        ({ nickname, relay }) => nickname === "Restart queued robot" && relay.includes("slow.example")
      );
      expect(slowFilters[0]?.since).toBeUndefined();
      expect(slowPublications.length).toBeGreaterThan(0);
      expect(slowPublications.every(({ afterFullPull }) => afterFullPull)).toBe(true);
      await vi.waitFor(() =>
        expect(restartedVault.useGarageVaultStore.getState().envelope?.restoreReconciliation).toBeUndefined()
      );
    } finally {
      restartedSync.garageSyncEngine.stop();
    }
  });
});

function installDirectQueryAdapter(): void {
  installDirectQueryAdapterOn(SimplePool.prototype);
}

function installDirectQueryAdapterOn(pool: SimplePool): void {
  vi.spyOn(pool, "ensureRelay").mockImplementation(async (relay: string) => {
    return {
      subscribe: (filters: Filter[], params: DirectQueryParams) => {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          params.onclose?.("closed by test query");
        };
        void pool.querySync([relay], filters[0]!).then(
          (events) => {
            if (closed) return;
            events.forEach((event) => params.onevent?.(event));
            params.oneose?.();
          },
          () => {
            if (closed) return;
            closed = true;
            params.onclose?.("relay query failed");
          }
        );
        return { close };
      }
    } as never;
  });
}

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

function syncGarageNow(
  coordinators: CoordinatorSummary[],
  options: { awaitReplication?: boolean; forcePublish?: boolean } = {}
): Promise<number> {
  garageSyncEngine.start(() => coordinators, false);
  return garageSyncEngine.synchronize(options);
}
