import { afterEach, describe, expect, it, vi } from "vitest";

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
});
