import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { garageSecretStore } from "@/domains/pro/garageSecretStore";
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
  upsertGarageEntry
} from "@/domains/pro/garageVault";
import { createPortableSettingsManifest } from "@/domains/pro/portableSettings";
import { createTradeHistoryManifest } from "@/domains/pro/tradeHistory";
import { hexToBase91 } from "@/lib/hexToBase91";
import {
  resetGarageVaultRuntimeForTests,
  selectProGarageSlots,
  useGarageVaultStore,
  type GarageRecoverySnapshot
} from "@/domains/pro/garageVaultStore";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";

const ENVELOPE_KEY = "robosats_exp_garage_envelope_v3";
const BACKUP_CONFIRMED_KEY = "robosats_exp_garage_backup_confirmed_v3";

describe("Garage vault persistence", () => {
  const storage = new Map<string, string>();
  let failNextManifestWrite = false;

  beforeEach(async () => {
    storage.clear();
    failNextManifestWrite = false;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === ENVELOPE_KEY && failNextManifestWrite) {
          failNextManifestWrite = false;
          throw new Error("simulated persistence failure");
        }
        storage.set(key, value);
      },
      removeItem: (key: string) => storage.delete(key)
    });
    await garageSecretStore.remove();
    resetGarageVaultRuntimeForTests();
    useProTradeIndexStore.getState().resetRuntimeCache();
  });

  afterEach(() => vi.unstubAllGlobals());

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

    expect(useGarageVaultStore.getState().pendingOutbox().map(({ item }) => item.key)).toEqual([robotKey]);
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
