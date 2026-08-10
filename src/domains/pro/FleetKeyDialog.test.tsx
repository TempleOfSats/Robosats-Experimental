// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetKeyDialog } from "@/domains/pro/FleetKeyDialog";

const mocks = vi.hoisted(() => ({
  downloadFleetKeyBackup: vi.fn(),
  playHaptic: vi.fn(),
  verifyBackup: vi.fn(),
  writeClipboard: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/domains/pro/fleetKeyBackup", () => ({
  downloadFleetKeyBackup: mocks.downloadFleetKeyBackup
}));

vi.mock("@/lib/clipboard", () => ({ writeClipboard: mocks.writeClipboard }));
vi.mock("@/lib/haptics", () => ({ playHaptic: mocks.playHaptic }));

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  mocks.downloadFleetKeyBackup.mockReset();
  mocks.playHaptic.mockReset();
  mocks.verifyBackup.mockReset();
  mocks.writeClipboard.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("FleetKeyDialog", () => {
  it("verifies the latest Fleet on open and completes the backup after the key is saved", async () => {
    const verification = deferred<{
      reachableRelays: number;
      requiredRelays: number;
      totalRelays: number;
      verified: boolean;
      verifiedRelays: number;
    }>();
    mocks.verifyBackup.mockReturnValueOnce(verification.promise);

    await act(async () =>
      root?.render(<FleetKeyDialog fleetKey="test-fleet-key" onClose={vi.fn()} onVerify={mocks.verifyBackup} />)
    );
    expect(document.body.textContent).toContain("Securing latest Fleet");

    await act(async () =>
      verification.resolve({
        reachableRelays: 2,
        requiredRelays: 2,
        totalRelays: 3,
        verified: true,
        verifiedRelays: 2
      })
    );
    expect(document.body.textContent).toContain("Fleet data verified");
    expect(document.body.textContent).toContain("Save this key to complete your backup.");
    expect(mocks.playHaptic.mock.calls).toEqual([["commit"], ["success"]]);

    await clickButton("Download Fleet key");
    expect(mocks.downloadFleetKeyBackup).toHaveBeenCalledWith("test-fleet-key");
    expect(document.body.textContent).toContain("Backup verified");
    expect(document.body.textContent).toContain("Your backup is ready.");
  });

  it("shows partial verification calmly and retries without closing the dialog", async () => {
    mocks.verifyBackup
      .mockResolvedValueOnce({
        reachableRelays: 1,
        requiredRelays: 2,
        totalRelays: 3,
        verified: false,
        verifiedRelays: 1
      })
      .mockResolvedValueOnce({
        reachableRelays: 2,
        requiredRelays: 2,
        totalRelays: 3,
        verified: true,
        verifiedRelays: 2
      });

    await act(async () =>
      root?.render(<FleetKeyDialog fleetKey="test-fleet-key" onClose={vi.fn()} onVerify={mocks.verifyBackup} />)
    );
    expect(document.body.textContent).toContain("Verification pending");
    expect(document.body.textContent).toContain("1 of 2 required relays");

    await clickButton("Retry");
    expect(mocks.verifyBackup).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Fleet data verified");
    expect(mocks.playHaptic.mock.calls).toEqual([["commit"], ["commit"], ["success"]]);
  });
});

async function clickButton(label: string) {
  const button =
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) =>
      item.textContent?.includes(label)
    );
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
