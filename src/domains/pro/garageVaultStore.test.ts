import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { garageSecretStore } from "@/domains/pro/garageSecretStore";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import {
  activeGarageEntries,
  createGarageManifest,
  createGarageSecret,
  deriveGarageRobotToken,
  encodeGarageToken,
  garageTokenId,
  upsertGarageEntry
} from "@/domains/pro/garageVault";
import { createPortableSettingsManifest } from "@/domains/pro/portableSettings";
import {
  resetGarageVaultRuntimeForTests,
  selectProGarageSlots,
  useGarageVaultStore,
  type GarageRecoverySnapshot
} from "@/domains/pro/garageVaultStore";

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
      settings: createPortableSettingsManifest("ffeeddccbbaa99887766554433221100", { theme: "dark" }, 1)
    };
    failNextManifestWrite = true;

    await expect(useGarageVaultStore.getState().restore(encodeGarageToken(nextSecret), snapshot))
      .rejects.toThrow("simulated persistence failure");

    expect(useGarageVaultStore.getState().exportToken()).toBe(previousToken);
    expect(storage.get(ENVELOPE_KEY)).toBe(previousEnvelope);
    expect(useGarageVaultStore.getState().status).toBe("needs-backup");
  });

  it("leaves no partial Garage when first setup persistence fails", async () => {
    failNextManifestWrite = true;

    await expect(useGarageVaultStore.getState().setup())
      .rejects.toThrow("simulated persistence failure");

    expect(await garageSecretStore.load()).toBeNull();
    expect(storage.get(ENVELOPE_KEY)).toBeUndefined();
    expect(useGarageVaultStore.getState()).toMatchObject({ status: "idle", manifest: undefined });
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

    expect(useGarageVaultStore.getState().pendingOutbox())
      .toEqual(expect.arrayContaining([expect.objectContaining({ record: expect.objectContaining({ id: robot.id }) })]));
  });

  it("persists relay acknowledgements until replication reaches quorum", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    await useGarageVaultStore.getState().createDerivedRobot("Replicating robot");
    const pending = useGarageVaultStore.getState().pendingOutbox().find(({ record }) => record.type === "robot")!;
    useGarageVaultStore.getState().recordOutboxAcknowledgements(
      pending.item.key,
      pending.item.revision,
      ["wss://first.example/relay/"],
      {
        eventId: "a".repeat(64),
        publishedAt: 1_000,
        revision: pending.record.revision,
        writerDeviceId: pending.record.writerDeviceId
      }
    );

    resetGarageVaultRuntimeForTests();
    await useGarageVaultStore.getState().initialize();

    expect(useGarageVaultStore.getState().pendingOutbox()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        item: expect.objectContaining({
          acceptedRelays: ["wss://first.example/relay/"],
          acceptedEventId: "a".repeat(64)
        })
      })
    ]));
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

    expect(selectProGarageSlots(slots, useGarageVaultStore.getState().manifest).map((slot) => slot.token))
      .toEqual([derived.token]);
    expect(selectProGarageSlots(slots, createGarageManifest("ffeeddccbbaa99887766554433221100")))
      .toEqual([]);
  });

  it("enforces 16 active robots and restores capacity after removal", async () => {
    await useGarageVaultStore.getState().setup();
    useGarageVaultStore.getState().markBackedUp();
    const tokens: string[] = [];
    for (let index = 0; index < 16; index += 1) {
      const robot = await useGarageVaultStore.getState().createDerivedRobot(`Robot ${index + 1}`);
      tokens.push(robot.token);
    }

    expect(activeGarageEntries(useGarageVaultStore.getState().manifest!)).toHaveLength(16);
    await expect(useGarageVaultStore.getState().createDerivedRobot("One too many"))
      .rejects.toThrow("A Fleet can hold up to 16 robots");

    await useGarageVaultStore.getState().removeRobot(tokens[0]);
    await expect(useGarageVaultStore.getState().createDerivedRobot("Replacement")).resolves.toMatchObject({
      nickname: "Replacement"
    });
    expect(activeGarageEntries(useGarageVaultStore.getState().manifest!)).toHaveLength(16);
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
