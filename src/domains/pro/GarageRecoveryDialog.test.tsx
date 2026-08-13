// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GarageRecoveryDialog } from "@/domains/pro/GarageRecoveryDialog";
import { createGarageManifest, encodeGarageToken } from "@/domains/pro/garageVault";
import { createPortableSettingsManifest } from "@/domains/pro/portableSettings";
import { createTradeHistoryManifest } from "@/domains/pro/tradeHistory";

const mocks = vi.hoisted(() => ({
  invalidateGarageSyncCursors: vi.fn(),
  parseFleetBackupFile: vi.fn(),
  playHaptic: vi.fn(),
  readFile: vi.fn(),
  recoverGarageSnapshot: vi.fn(),
  restore: vi.fn(),
  restoreRobotManifest: vi.fn()
}));

vi.mock("@/domains/coordinators/federationStore", () => ({
  useFederationStore: (selector: (state: { coordinators: never[] }) => unknown) => selector({ coordinators: [] })
}));

vi.mock("@/domains/pro/fleetKeyBackup", () => ({
  parseFleetBackupFile: mocks.parseFleetBackupFile
}));

vi.mock("@/domains/pro/garageSync", () => ({
  invalidateGarageSyncCursors: mocks.invalidateGarageSyncCursors,
  recoverGarageSnapshot: mocks.recoverGarageSnapshot
}));

vi.mock("@/domains/pro/garageVaultStore", () => {
  const state = {
    restore: mocks.restore,
    restoreRobotManifest: mocks.restoreRobotManifest
  };
  const useGarageVaultStore = (selector: (value: typeof state) => unknown) => selector(state);
  useGarageVaultStore.getState = () => state;
  return { useGarageVaultStore };
});

vi.mock("@/lib/haptics", () => ({ playHaptic: mocks.playHaptic }));

let root: Root | undefined;
const testSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const testFleetKey = encodeGarageToken(testSecret);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  };
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.readFile.mockResolvedValue("{}");
  mocks.restore.mockResolvedValue(undefined);
  mocks.restoreRobotManifest.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("GarageRecoveryDialog", () => {
  it("keeps file recovery collapsed behind an advanced disclosure", async () => {
    await renderDialog();

    const advanced = document.querySelector<HTMLDetailsElement>(".pro-fleet-recovery-advanced");
    expect(advanced?.open).toBe(false);
    expect(advanced?.querySelector("summary")?.textContent).toContain("Advanced recovery");
    expect(advanced?.textContent).toContain("Choose Fleet backup");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Choose offline Fleet backup"]')?.hidden).toBe(
      true
    );
    expect(buttonNamed("Restore Fleet")).toBeTruthy();
  });

  it("offers a simple retry while keeping advanced file recovery closed", async () => {
    mocks.recoverGarageSnapshot.mockRejectedValue(new Error("No coordinator relay is available."));
    await renderDialog(testFleetKey);

    await clickButton("Restore Fleet");

    expect(document.body.textContent).toContain("No coordinator relay is available");
    expect(buttonNamed("Retry")).toBeTruthy();
    expect(document.querySelector<HTMLDetailsElement>(".pro-fleet-recovery-advanced")?.open).toBe(false);
  });

  it("passes relay coverage without mentioning background coordinator checks", async () => {
    const snapshot = emptyRelayRecovery().snapshot;
    const coverage = {
      reconciledRelays: ["wss://fast.example/relay/"],
      targetRelays: ["wss://fast.example/relay/", "wss://slow.example/relay/"]
    };
    mocks.recoverGarageSnapshot.mockResolvedValue({ coverage, snapshot });
    await renderDialog(testFleetKey);

    await clickButton("Restore Fleet");

    expect(mocks.restore).toHaveBeenCalledWith(testFleetKey, snapshot, coverage);
    expect(document.body.textContent).toContain("Fleet restored");
    expect(document.body.textContent).not.toContain("Checking coordinator status");
    expect(document.body.textContent).not.toContain("Slower coordinator relays");
  });

  it("restores robot identities locally without querying relays", async () => {
    const garage = createGarageManifest("00112233445566778899aabbccddeeff");
    mocks.parseFleetBackupFile.mockReturnValue({
      fleetKey: testFleetKey,
      robotSnapshot: {
        format: "robosats-exp-fleet-robots",
        version: 1,
        createdAt: 123,
        garage
      }
    });
    await renderDialog();

    await selectFile(fileOfSize(2));

    expect(mocks.invalidateGarageSyncCursors).toHaveBeenCalledWith(testSecret);
    expect(mocks.restoreRobotManifest).toHaveBeenCalledWith(testFleetKey, garage);
    expect(mocks.invalidateGarageSyncCursors.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.restoreRobotManifest.mock.invocationCallOrder[0]
    );
    expect(mocks.recoverGarageSnapshot).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Fleet restored");
    expect(document.body.textContent).toContain("Status, presets, and history reconnect when available");
    expect(mocks.playHaptic.mock.calls).toEqual([["commit"], ["success"]]);
  });

  it("rejects oversized files before reading them", async () => {
    await renderDialog();

    await selectFile(fileOfSize(128 * 1024 + 1));

    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.parseFleetBackupFile).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Fleet backup is too large");
  });

  it("keeps previous key-only files on the relay recovery path", async () => {
    mocks.parseFleetBackupFile.mockReturnValue({ fleetKey: testFleetKey });
    mocks.recoverGarageSnapshot.mockResolvedValue(emptyRelayRecovery());
    await renderDialog();

    await selectFile(fileOfSize(2));

    expect(mocks.recoverGarageSnapshot).toHaveBeenCalledOnce();
    expect(mocks.restoreRobotManifest).not.toHaveBeenCalled();
    expect(mocks.playHaptic.mock.calls).toEqual([["commit"], ["success"]]);
  });

  it("keeps the current Fleet when a complete reconciliation cannot be prepared", async () => {
    const garage = createGarageManifest("00112233445566778899aabbccddeeff");
    mocks.parseFleetBackupFile.mockReturnValue({
      fleetKey: testFleetKey,
      robotSnapshot: {
        format: "robosats-exp-fleet-robots",
        version: 1,
        createdAt: 123,
        garage
      }
    });
    mocks.invalidateGarageSyncCursors.mockImplementation(() => {
      throw new Error("Could not prepare a complete Fleet reconciliation.");
    });
    await renderDialog();

    await selectFile(fileOfSize(2));

    expect(mocks.restoreRobotManifest).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Could not prepare a complete Fleet reconciliation");
    expect(document.querySelector<HTMLDetailsElement>(".pro-fleet-recovery-advanced")?.open).toBe(true);
    expect(buttonNamed("Restore Fleet")).toBeTruthy();
    expect(buttonNamed("Retry")).toBeUndefined();
    expect(document.querySelector<HTMLInputElement>(".pro-fleet-key-input input")?.getAttribute("aria-invalid")).toBe(
      "false"
    );
    expect(mocks.playHaptic.mock.calls).toEqual([["commit"], ["reject"]]);
  });
});

async function renderDialog(initialFleetKey = "") {
  await act(async () => root?.render(<GarageRecoveryDialog initialFleetKey={initialFleetKey} onClose={vi.fn()} />));
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes(name)
  );
}

async function clickButton(name: string) {
  const button = buttonNamed(name);
  if (!button) throw new Error(`Missing ${name} button`);
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function selectFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Choose offline Fleet backup"]');
  if (!input) throw new Error("Missing offline backup input");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.dynamicImportSettled();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function fileOfSize(size: number): File {
  return { size, text: mocks.readFile } as unknown as File;
}

function emptyRelayRecovery() {
  const deviceId = "00112233445566778899aabbccddeeff";
  return {
    coverage: { reconciledRelays: [], targetRelays: [] },
    snapshot: {
      format: "robosats-exp-garage-snapshot" as const,
      version: 3 as const,
      createdAt: 123,
      garage: createGarageManifest(deviceId),
      settings: createPortableSettingsManifest(deviceId, { theme: "dark" }),
      history: createTradeHistoryManifest(deviceId)
    }
  };
}
