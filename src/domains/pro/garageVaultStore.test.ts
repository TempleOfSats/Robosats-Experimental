import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { garageSecretStore } from "@/domains/pro/garageSecretStore";
import { decryptGaragePayload, encryptGaragePayload } from "@/domains/pro/garageCrypto";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import type { OrderDto } from "@/domains/orders/order.types";
import {
  activeGarageEntries,
  createGarageManifest,
  createGarageSecret,
  deriveGarageRobotToken,
  encodeGarageToken,
  GARAGE_LIMITS,
  garageTokenId,
  removeGarageEntry,
  upsertGarageEntry
} from "@/domains/pro/garageVault";
import { createPortableSettingsManifest } from "@/domains/pro/portableSettings";
import { createTradeHistoryManifest } from "@/domains/pro/tradeHistory";
import { hexToBase91 } from "@/lib/hexToBase91";
import {
  resetGarageVaultRuntimeForTests,
  selectProGarageSlots,
  useGarageVaultStore,
  type GarageLocalEnvelope,
  type GarageRecoverySnapshot
} from "@/domains/pro/garageVaultStore";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import { FakeIndexedDb } from "@/test/fakeIndexedDb";

const ENVELOPE_KEY = "robosats_exp_garage_envelope_v3";
const BACKUP_CONFIRMED_KEY = "robosats_exp_garage_backup_confirmed_v3";

describe("Garage vault persistence", () => {
  const storage = new Map<string, string>();
  let failNextManifestWrite = false;
  let envelopeWrites = 0;

  beforeEach(async () => {
    storage.clear();
    failNextManifestWrite = false;
    envelopeWrites = 0;
    vi.stubGlobal("indexedDB", new FakeIndexedDb().factory);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === ENVELOPE_KEY && failNextManifestWrite) {
          failNextManifestWrite = false;
          throw new Error("simulated persistence failure");
        }
        if (key === ENVELOPE_KEY) envelopeWrites += 1;
        storage.set(key, value);
      },
      removeItem: (key: string) => storage.delete(key)
    });
    await garageSecretStore.remove();
    resetGarageVaultRuntimeForTests();
    useProTradeIndexStore.getState().resetRuntimeCache();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("preserves corrupt local Fleet bytes and surfaces a recoverable error", async () => {
    await useGarageVaultStore.getState().setup();
    const corruptCiphertext = "preserve-this-unreadable-envelope";
    storage.set(ENVELOPE_KEY, corruptCiphertext);
    resetGarageVaultRuntimeForTests();
    envelopeWrites = 0;

    await useGarageVaultStore.getState().initialize();

    expect(useGarageVaultStore.getState()).toMatchObject({
      status: "error",
      envelope: undefined,
      manifest: undefined,
      error: expect.stringContaining("data preserved")
    });
    expect(storage.get(ENVELOPE_KEY)).toBe(corruptCiphertext);
    expect(envelopeWrites).toBe(0);
  });

  it("preserves a valid envelope when the stored Fleet key belongs to another Fleet", async () => {
    await useGarageVaultStore.getState().setup();
    const originalCiphertext = storage.get(ENVELOPE_KEY);
    if (!originalCiphertext) throw new Error("Expected a persisted Fleet envelope.");
    await garageSecretStore.save(encodeGarageToken(createGarageSecret()));
    resetGarageVaultRuntimeForTests();
    envelopeWrites = 0;

    await useGarageVaultStore.getState().initialize();

    expect(useGarageVaultStore.getState()).toMatchObject({
      status: "error",
      envelope: undefined,
      manifest: undefined,
      error: expect.stringContaining("data preserved")
    });
    expect(storage.get(ENVELOPE_KEY)).toBe(originalCiphertext);
    expect(envelopeWrites).toBe(0);
  });

  it("replaces preserved unreadable bytes only after an explicit validated restore", async () => {
    const secret = createGarageSecret();
    const token = encodeGarageToken(secret);
    const entryId = "1134567890abcdef1234567890abcdef";
    const manifest = upsertGarageEntry(createGarageManifest("ffeeddccbbaa99887766554433221100"), {
      id: entryId,
      tokenId: garageTokenId(deriveGarageRobotToken(secret, entryId)),
      nickname: "Recovered robot"
    });
    await garageSecretStore.save(token);
    const corruptCiphertext = "preserve-until-restore-succeeds";
    storage.set(ENVELOPE_KEY, corruptCiphertext);

    await useGarageVaultStore.getState().initialize();
    expect(storage.get(ENVELOPE_KEY)).toBe(corruptCiphertext);

    await useGarageVaultStore.getState().restoreRobotManifest(token, manifest);

    expect(useGarageVaultStore.getState()).toMatchObject({ status: "ready", error: undefined });
    expect(storage.get(ENVELOPE_KEY)).not.toBe(corruptCiphertext);
    expect(activeGarageEntries(useGarageVaultStore.getState().manifest!).map(({ nickname }) => nickname)).toEqual([
      "Recovered robot"
    ]);
  });

  it("restores the previous Garage when replacement persistence fails", async () => {
    await useGarageVaultStore.getState().setup();
    const previousToken = useGarageVaultStore.getState().exportToken();
    const previousEnvelope = storage.get(ENVELOPE_KEY);

    const nextSecret = createGarageSecret();
    const entryId = "1234567890abcdef1234567890abcdef";
    const restoredManifest = upsertGarageEntry(createGarageManifest("ffeeddccbbaa99887766554433221100"), {
      id: entryId,
      tokenId: garageTokenId(deriveGarageRobotToken(nextSecret, entryId)),
      nickname: "Restored"
    });
    const snapshot: GarageRecoverySnapshot = {
      format: "robosats-exp-garage-snapshot",
      version: 3,
      createdAt: 1,
      garage: restoredManifest,
      settings: createPortableSettingsManifest("ffeeddccbbaa99887766554433221100", { theme: "dark" }, 1),
      history: createTradeHistoryManifest("ffeeddccbbaa99887766554433221100", 1)
    };
    failNextManifestWrite = true;

    await expect(useGarageVaultStore.getState().restore(encodeGarageToken(nextSecret), snapshot)).rejects.toThrow(
      "simulated persistence failure"
    );

    expect(useGarageVaultStore.getState().exportToken()).toBe(previousToken);
    expect(storage.get(ENVELOPE_KEY)).toBe(previousEnvelope);
    expect(useGarageVaultStore.getState().status).toBe("needs-backup");
  });

  it("persists relay coverage with a recovered snapshot across restart", async () => {
    const secret = createGarageSecret();
    const token = encodeGarageToken(secret);
    const entryId = "1334567890abcdef1234567890abcdef";
    const garage = upsertGarageEntry(createGarageManifest("ffeeddccbbaa99887766554433221100"), {
      id: entryId,
      tokenId: garageTokenId(deriveGarageRobotToken(secret, entryId)),
      nickname: "Relay recovered"
    });
    const snapshot: GarageRecoverySnapshot = {
      format: "robosats-exp-garage-snapshot",
      version: 3,
      createdAt: 1,
      garage,
      settings: createPortableSettingsManifest("ffeeddccbbaa99887766554433221100", { theme: "dark" }, 1),
      history: createTradeHistoryManifest("ffeeddccbbaa99887766554433221100", 1)
    };
    const coverage = {
      targetRelays: ["wss://slow.example/relay/", "wss://fast.example/relay/"],
      reconciledRelays: ["wss://fast.example/relay/"]
    };

    await useGarageVaultStore.getState().restore(token, snapshot, coverage);

    const barrier = useGarageVaultStore.getState().envelope?.restoreReconciliation;
    expect(barrier).toMatchObject({
      robotIds: [entryId],
      targetRelays: ["wss://fast.example/relay/", "wss://slow.example/relay/"],
      reconciledRelays: ["wss://fast.example/relay/"]
    });
    expect(decryptStoredEnvelope(secret, storage.get(ENVELOPE_KEY)).restoreReconciliation).toEqual(barrier);

    resetGarageVaultRuntimeForTests();
    await useGarageVaultStore.getState().initialize();

    expect(useGarageVaultStore.getState().envelope?.restoreReconciliation).toEqual(barrier);
  });

  it("restores an offline robot manifest without publishing synthetic settings or history", async () => {
    const nextSecret = createGarageSecret();
    const entryId = "1234567890abcdef1234567890abcdef";
    let robotManifest = upsertGarageEntry(createGarageManifest("ffeeddccbbaa99887766554433221100"), {
      id: entryId,
      tokenId: garageTokenId(deriveGarageRobotToken(nextSecret, entryId)),
      nickname: "Offline robot"
    });
    const removedId = "2234567890abcdef1234567890abcdef";
    robotManifest = upsertGarageEntry(robotManifest, {
      id: removedId,
      tokenId: garageTokenId(deriveGarageRobotToken(nextSecret, removedId)),
      nickname: "Retired robot"
    });
    robotManifest = removeGarageEntry(robotManifest, removedId);

    await useGarageVaultStore.getState().restoreRobotManifest(encodeGarageToken(nextSecret), robotManifest);
    useGarageVaultStore.getState().queueHeartbeat(Date.now() - 1);

    expect(activeGarageEntries(useGarageVaultStore.getState().manifest!)).toHaveLength(1);
    expect(useGarageVaultStore.getState().history?.entries).toEqual([]);
    expect(
      useGarageVaultStore
        .getState()
        .pendingOutbox()
        .map(({ record }) => record.type)
    ).toEqual(["robot", "robot-tombstone"]);
  });

  it("persists the offline restore barrier atomically with its robot outbox", async () => {
    const secret = createGarageSecret();
    const token = encodeGarageToken(secret);
    const entryId = "2734567890abcdef1234567890abcdef";
    const robotManifest = upsertGarageEntry(createGarageManifest("ffeeddccbbaa99887766554433221100"), {
      id: entryId,
      tokenId: garageTokenId(deriveGarageRobotToken(secret, entryId)),
      nickname: "Durable offline robot"
    });

    await useGarageVaultStore.getState().restoreRobotManifest(token, robotManifest);

    const barrier = useGarageVaultStore.getState().envelope?.restoreReconciliation;
    const pendingRobot = useGarageVaultStore
      .getState()
      .pendingOutbox()
      .find(({ record }) => record.type === "robot" && record.id === entryId);
    const persisted = decryptStoredEnvelope(secret, storage.get(ENVELOPE_KEY));
    expect(barrier).toMatchObject({
      robotIds: [entryId],
      targetRelays: [],
      reconciledRelays: []
    });
    expect(pendingRobot).toBeDefined();
    expect(persisted.restoreReconciliation).toEqual(barrier);
    expect(persisted.outbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: pendingRobot?.item.key, revision: pendingRobot?.item.revision })
      ])
    );

    resetGarageVaultRuntimeForTests();
    await useGarageVaultStore.getState().initialize();

    expect(useGarageVaultStore.getState().envelope?.restoreReconciliation).toEqual(barrier);
    expect(useGarageVaultStore.getState().pendingOutbox()).toEqual(
      expect.arrayContaining([expect.objectContaining({ record: expect.objectContaining({ id: entryId }) })])
    );
  });

  it("loads a legacy envelope without a restore reconciliation field", async () => {
    const secret = createGarageSecret();
    const token = encodeGarageToken(secret);
    const entryId = "2834567890abcdef1234567890abcdef";
    const robotManifest = upsertGarageEntry(createGarageManifest("ffeeddccbbaa99887766554433221100"), {
      id: entryId,
      tokenId: garageTokenId(deriveGarageRobotToken(secret, entryId)),
      nickname: "Legacy envelope robot"
    });
    await useGarageVaultStore.getState().restoreRobotManifest(token, robotManifest);
    const legacyEnvelope = decryptStoredEnvelope(secret, storage.get(ENVELOPE_KEY));
    delete legacyEnvelope.restoreReconciliation;
    storage.set(ENVELOPE_KEY, encryptGaragePayload(secret, "local", JSON.stringify(legacyEnvelope)));

    resetGarageVaultRuntimeForTests();
    await useGarageVaultStore.getState().initialize();

    expect(useGarageVaultStore.getState()).toMatchObject({ status: "ready" });
    expect(useGarageVaultStore.getState().envelope?.restoreReconciliation).toBeUndefined();
    expect(activeGarageEntries(useGarageVaultStore.getState().manifest!).map(({ nickname }) => nickname)).toEqual([
      "Legacy envelope robot"
    ]);
    expect(useGarageVaultStore.getState().pendingOutbox()).toEqual(
      expect.arrayContaining([expect.objectContaining({ record: expect.objectContaining({ id: entryId }) })])
    );
  });

  it("does not unlock a relay when reconciliation progress fails to persist", async () => {
    const secret = createGarageSecret();
    const token = encodeGarageToken(secret);
    const entryId = "2934567890abcdef1234567890abcdef";
    const robotManifest = upsertGarageEntry(createGarageManifest("ffeeddccbbaa99887766554433221100"), {
      id: entryId,
      tokenId: garageTokenId(deriveGarageRobotToken(secret, entryId)),
      nickname: "Guarded offline robot"
    });
    await useGarageVaultStore.getState().restoreRobotManifest(token, robotManifest);
    const barrier = useGarageVaultStore.getState().bindRestoreReconciliationRelays(["wss://first.example/relay/"])!;
    const persistedBefore = storage.get(ENVELOPE_KEY);
    failNextManifestWrite = true;

    expect(() =>
      useGarageVaultStore.getState().markRestoreRelaysReconciled(barrier.id, ["wss://first.example/relay/"])
    ).toThrow("simulated persistence failure");

    expect(storage.get(ENVELOPE_KEY)).toBe(persistedBefore);
    expect(useGarageVaultStore.getState().envelope?.restoreReconciliation?.reconciledRelays).toEqual([]);
  });

  it("restores the previous Fleet when offline robot persistence fails", async () => {
    const previousSecret = createGarageSecret();
    const previousEntryId = "3034567890abcdef1234567890abcdef";
    const previousManifest = upsertGarageEntry(createGarageManifest("ffeeddccbbaa99887766554433221100"), {
      id: previousEntryId,
      tokenId: garageTokenId(deriveGarageRobotToken(previousSecret, previousEntryId)),
      nickname: "Previous offline robot"
    });
    await useGarageVaultStore.getState().restoreRobotManifest(encodeGarageToken(previousSecret), previousManifest);
    const boundBarrier = useGarageVaultStore
      .getState()
      .bindRestoreReconciliationRelays(["wss://first.example/relay/", "wss://second.example/relay/"])!;
    useGarageVaultStore.getState().markRestoreRelaysReconciled(boundBarrier.id, ["wss://first.example/relay/"]);
    const previousToken = useGarageVaultStore.getState().exportToken();
    const previousEnvelope = storage.get(ENVELOPE_KEY);
    const previousBarrier = structuredClone(useGarageVaultStore.getState().envelope?.restoreReconciliation);
    const nextSecret = createGarageSecret();
    const entryId = "3234567890abcdef1234567890abcdef";
    const robotManifest = upsertGarageEntry(createGarageManifest("ffeeddccbbaa99887766554433221100"), {
      id: entryId,
      tokenId: garageTokenId(deriveGarageRobotToken(nextSecret, entryId)),
      nickname: "Offline robot"
    });
    failNextManifestWrite = true;

    await expect(
      useGarageVaultStore.getState().restoreRobotManifest(encodeGarageToken(nextSecret), robotManifest)
    ).rejects.toThrow("simulated persistence failure");

    expect(useGarageVaultStore.getState().exportToken()).toBe(previousToken);
    expect(storage.get(ENVELOPE_KEY)).toBe(previousEnvelope);
    expect(useGarageVaultStore.getState().envelope?.restoreReconciliation).toEqual(previousBarrier);

    resetGarageVaultRuntimeForTests();
    await useGarageVaultStore.getState().initialize();
    expect(useGarageVaultStore.getState().exportToken()).toBe(previousToken);
    expect(useGarageVaultStore.getState().envelope?.restoreReconciliation).toEqual(previousBarrier);
  });

  it("leaves no partial Garage when first setup persistence fails", async () => {
    failNextManifestWrite = true;

    await expect(useGarageVaultStore.getState().setup()).rejects.toThrow("simulated persistence failure");

    expect(await garageSecretStore.load()).toBeNull();
    expect(storage.get(ENVELOPE_KEY)).toBeUndefined();
    expect(useGarageVaultStore.getState()).toMatchObject({ status: "idle", manifest: undefined });
  });

  it("persists a sanitized finished trade in the encrypted Fleet envelope", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    useGarageVaultStore.getState().archiveTrade({
      slotId: hexToBase91("a".repeat(64)),
      robotName: "Finished Robot",
      robotHashId: "robot-hash",
      coordinatorShortAlias: "lake",
      order: completedOrder(),
      observedAt: Date.now()
    });

    expect(useGarageVaultStore.getState().history?.entries[0]).toMatchObject({
      robotName: "Finished Robot",
      orderId: 42,
      outcome: "completed"
    });
    expect(storage.get(ENVELOPE_KEY)).not.toContain("Finished Robot");

    resetGarageVaultRuntimeForTests();
    await useGarageVaultStore.getState().initialize();
    expect(useGarageVaultStore.getState().history?.entries[0]?.orderId).toBe(42);
  });

  it.each([
    [17, "dispute-won"],
    [18, "dispute-lost"]
  ] as const)("stores resolved dispute status %i in Fleet history", async (status, outcome) => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();

    const result = useGarageVaultStore.getState().archiveTrade({
      slotId: hexToBase91("b".repeat(64)),
      robotName: "Resolved Robot",
      robotHashId: "resolved-robot-hash",
      coordinatorShortAlias: "lake",
      order: { ...completedOrder(), id: 40 + status, status },
      observedAt: Date.now()
    });

    expect(result).toBe("archived");
    expect(useGarageVaultStore.getState().history?.entries[0]).toMatchObject({ outcome });
  });

  it("restores an unacknowledged mutation from the encrypted envelope", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const robot = await useGarageVaultStore.getState().createDerivedRobot("Pending robot");
    expect(storage.get(ENVELOPE_KEY)).not.toContain(robot.token);
    const pending = useGarageVaultStore.getState().pendingOutbox();
    expect(pending.some(({ record }) => record.type === "robot" && record.id === robot.id)).toBe(true);

    resetGarageVaultRuntimeForTests();
    await useGarageVaultStore.getState().initialize();

    expect(useGarageVaultStore.getState().pendingOutbox()).toEqual(
      expect.arrayContaining([expect.objectContaining({ record: expect.objectContaining({ id: robot.id }) })])
    );
  });

  it("marks a newly derived robot ready without a coordinator request", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const createdAfter = Date.now();

    const robot = await useGarageVaultStore.getState().createDerivedRobot("Fresh robot");
    const slotId = deriveRobotIdentity(robot.token).tokenSHA256;
    const sync = useProTradeIndexStore.getState().syncBySlot[slotId];

    expect(sync).toMatchObject({
      slotId,
      inFlight: false
    });
    expect(sync.locallyReadyAt).toBeGreaterThanOrEqual(createdAfter);
    expect(sync.nextEligibleAt).toBeGreaterThan(sync.locallyReadyAt!);
    expect(sync.lastSuccessAt).toBeUndefined();
  });

  it("persists relay acknowledgements until replication reaches quorum", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Replicating robot");
    const pending = useGarageVaultStore
      .getState()
      .pendingOutbox()
      .find(({ record }) => record.type === "robot")!;
    useGarageVaultStore
      .getState()
      .recordOutboxAcknowledgements(pending.item.key, pending.item.revision, ["wss://first.example/relay/"], {
        eventId: "a".repeat(64),
        publishedAt: 1_000,
        revision: pending.record.revision,
        writerDeviceId: pending.record.writerDeviceId
      });

    resetGarageVaultRuntimeForTests();
    await useGarageVaultStore.getState().initialize();

    expect(useGarageVaultStore.getState().pendingOutbox()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({
            acceptedRelays: ["wss://first.example/relay/"],
            acceptedEventId: "a".repeat(64)
          })
        })
      ])
    );
  });

  it("queues routine heartbeats only for current stale records", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Heartbeat robot");
    useGarageVaultStore.getState().queueHeartbeat();
    const publishedAt = 10_000;
    const pending = useGarageVaultStore.getState().pendingOutbox();
    for (const { item, record } of pending) {
      useGarageVaultStore.getState().acknowledgeOutbox(item.key, item.revision, {
        eventId: item.key.includes("robot") ? "a".repeat(64) : "b".repeat(64),
        publishedAt,
        revision: record.revision,
        writerDeviceId: record.writerDeviceId
      });
    }
    const robotKey = pending.find(({ record }) => record.type === "robot")!.item.key;
    const envelope = useGarageVaultStore.getState().envelope!;
    useGarageVaultStore.setState({
      envelope: {
        ...envelope,
        observed: {
          ...envelope.observed,
          [robotKey]: { ...envelope.observed[robotKey], publishedAt: 1 },
          "history-sync:trade-history:obsolete": {
            eventId: "c".repeat(64),
            publishedAt: 1,
            revision: 1,
            writerDeviceId: envelope.deviceId
          }
        }
      }
    });

    useGarageVaultStore.getState().queueHeartbeat(5_000);

    expect(
      useGarageVaultStore
        .getState()
        .pendingOutbox()
        .map(({ item }) => item.key)
    ).toEqual([robotKey]);
  });

  it("projects only robots derived by the active Garage", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const derived = await useGarageVaultStore.getState().createDerivedRobot("Derived");
    const importedToken = "ImportedRobotToken012345678901234567";
    const slots = [
      { ...deriveRobotIdentity(derived.token), nickname: "Derived", earnedRewards: 0, robots: {} },
      { ...deriveRobotIdentity(importedToken), nickname: "Imported", earnedRewards: 0, robots: {} }
    ];

    expect(selectProGarageSlots(slots, useGarageVaultStore.getState().manifest).map((slot) => slot.token)).toEqual([
      derived.token
    ]);
    expect(selectProGarageSlots(slots, createGarageManifest("ffeeddccbbaa99887766554433221100"))).toEqual([]);
  });

  it("enforces the active robot limit and restores capacity after removal", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const tokens: string[] = [];
    for (let index = 0; index < GARAGE_LIMITS.activeRobots; index += 1) {
      const robot = await useGarageVaultStore.getState().createDerivedRobot(`Robot ${index + 1}`);
      tokens.push(robot.token);
    }

    expect(activeGarageEntries(useGarageVaultStore.getState().manifest!)).toHaveLength(GARAGE_LIMITS.activeRobots);
    await expect(useGarageVaultStore.getState().createDerivedRobot("One too many")).rejects.toThrow(
      `A Fleet can hold up to ${GARAGE_LIMITS.activeRobots} robots`
    );

    await useGarageVaultStore.getState().removeRobot(tokens[0]);
    await expect(useGarageVaultStore.getState().createDerivedRobot("Replacement")).resolves.toMatchObject({
      nickname: "Replacement"
    });
    expect(activeGarageEntries(useGarageVaultStore.getState().manifest!)).toHaveLength(GARAGE_LIMITS.activeRobots);
  });

  it("abandons the Fleet without leaving its local key or envelope", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Disposable");

    await useGarageVaultStore.getState().abandon();

    expect(await garageSecretStore.load()).toBeNull();
    expect(storage.get(ENVELOPE_KEY)).toBeUndefined();
    expect(storage.get(BACKUP_CONFIRMED_KEY)).toBeUndefined();
    expect(useGarageVaultStore.getState()).toMatchObject({
      status: "unconfigured",
      envelope: undefined,
      manifest: undefined
    });
  });
});

function decryptStoredEnvelope(secret: Uint8Array, ciphertext: string | undefined): GarageLocalEnvelope {
  if (!ciphertext) throw new Error("Expected a persisted Fleet envelope.");
  return JSON.parse(decryptGaragePayload(secret, "local", ciphertext)) as GarageLocalEnvelope;
}

function completedOrder(): OrderDto {
  return {
    id: 42,
    status: 14,
    type: 0,
    amount: 100,
    currency: 1,
    payment_method: "SEPA",
    premium: 0,
    satoshis: 1_000,
    is_maker: false,
    is_taker: true,
    is_buyer: true,
    is_seller: false,
    maker_nick: "Maker",
    maker_hash_id: "maker",
    taker_nick: "Taker",
    taker_hash_id: "taker",
    bond_invoice: "ln-sensitive",
    bond_satoshis: 0,
    escrow_invoice: "",
    escrow_satoshis: 0,
    invoice_amount: 0,
    swap_allowed: false,
    suggested_mining_fee_rate: 0,
    swap_fee_rate: 0,
    expires_at: "2026-07-23T12:00:00Z",
    shortAlias: "lake"
  };
}
