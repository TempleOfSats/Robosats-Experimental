import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeIndexedDb } from "@/test/fakeIndexedDb";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Garage secret persistence", () => {
  it("routes native secrets directly through the encrypted platform bridge", async () => {
    const getStorage = vi.fn(() => "stored-fleet-key");
    const setStorage = vi.fn();
    const deleteStorage = vi.fn();
    const localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("window", {
      AndroidAppRobosats: {
        httpRequest: vi.fn(),
        getStorage,
        setStorage,
        deleteStorage
      }
    });

    const { garageSecretStore } = await import("./garageSecretStore");

    await expect(garageSecretStore.load()).resolves.toBe("stored-fleet-key");
    await garageSecretStore.save("replacement-fleet-key");
    await garageSecretStore.remove();

    expect(getStorage).toHaveBeenCalledWith("robosats_exp_garage_secret_v3");
    expect(setStorage).toHaveBeenCalledWith("robosats_exp_garage_secret_v3", "replacement-fleet-key");
    expect(deleteStorage).toHaveBeenCalledWith("robosats_exp_garage_secret_v3");
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
  });

  it("rejects save and load when durable browser storage is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const { garageSecretStore } = await import("./garageSecretStore");

    await expect(garageSecretStore.save("must-not-be-memory-only")).rejects.toThrow("Storage unavailable.");
    await expect(garageSecretStore.load()).rejects.toThrow("Storage unavailable.");
    await expect(garageSecretStore.remove()).rejects.toThrow("Storage unavailable.");
  });

  it("returns null only when durable browser storage has no Fleet key", async () => {
    const indexedDb = new FakeIndexedDb();
    vi.stubGlobal("indexedDB", indexedDb.factory);
    const { garageSecretStore } = await import("./garageSecretStore");

    await expect(garageSecretStore.load()).resolves.toBeNull();
  });

  it("loads a durably saved Fleet key after a module restart", async () => {
    const indexedDb = new FakeIndexedDb();
    vi.stubGlobal("indexedDB", indexedDb.factory);
    const firstProcess = await import("./garageSecretStore");
    await firstProcess.garageSecretStore.save("durable-fleet-key");

    vi.resetModules();
    const restartedProcess = await import("./garageSecretStore");

    await expect(restartedProcess.garageSecretStore.load()).resolves.toBe("durable-fleet-key");
  });

  it("waits for the key and ciphertext from the same read transaction", async () => {
    const indexedDb = new FakeIndexedDb();
    vi.stubGlobal("indexedDB", indexedDb.factory);
    const { garageSecretStore } = await import("./garageSecretStore");
    await garageSecretStore.save("transactional-fleet-key");
    indexedDb.delayNextRead = true;

    await expect(garageSecretStore.load()).resolves.toBe("transactional-fleet-key");
  });

  it("rejects a failed write and keeps the previously durable key", async () => {
    const indexedDb = new FakeIndexedDb();
    vi.stubGlobal("indexedDB", indexedDb.factory);
    const firstProcess = await import("./garageSecretStore");
    await firstProcess.garageSecretStore.save("previous-fleet-key");
    indexedDb.failNextWrite = true;

    await expect(firstProcess.garageSecretStore.save("memory-only-replacement")).rejects.toThrow(
      "Fleet storage failed."
    );

    vi.resetModules();
    const restartedProcess = await import("./garageSecretStore");
    await expect(restartedProcess.garageSecretStore.load()).resolves.toBe("previous-fleet-key");
  });

  it("surfaces a durable read failure without substituting process memory", async () => {
    const indexedDb = new FakeIndexedDb();
    vi.stubGlobal("indexedDB", indexedDb.factory);
    const firstProcess = await import("./garageSecretStore");
    await firstProcess.garageSecretStore.save("persisted-fleet-key");
    indexedDb.failNextRead = true;

    vi.resetModules();
    const failedProcess = await import("./garageSecretStore");
    await expect(failedProcess.garageSecretStore.load()).rejects.toThrow("Fleet storage failed.");

    vi.resetModules();
    const recoveredProcess = await import("./garageSecretStore");
    await expect(recoveredProcess.garageSecretStore.load()).resolves.toBe("persisted-fleet-key");
  });

  it("rejects a failed removal and leaves the durable Fleet key intact", async () => {
    const indexedDb = new FakeIndexedDb();
    vi.stubGlobal("indexedDB", indexedDb.factory);
    const firstProcess = await import("./garageSecretStore");
    await firstProcess.garageSecretStore.save("persisted-fleet-key");
    indexedDb.failNextWrite = true;

    await expect(firstProcess.garageSecretStore.remove()).rejects.toThrow("Fleet storage failed.");

    vi.resetModules();
    const restartedProcess = await import("./garageSecretStore");
    await expect(restartedProcess.garageSecretStore.load()).resolves.toBe("persisted-fleet-key");
  });
});
