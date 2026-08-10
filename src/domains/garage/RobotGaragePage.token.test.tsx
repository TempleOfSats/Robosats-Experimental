// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { downloadRobotTokenBackupMock, writeClipboardMock } = vi.hoisted(() => ({
  downloadRobotTokenBackupMock: vi.fn(),
  writeClipboardMock: vi.fn()
}));

vi.mock("@/domains/garage/tokenBackup", () => ({
  downloadRobotTokenBackup: downloadRobotTokenBackupMock
}));

vi.mock("@/lib/clipboard", () => ({
  writeClipboard: writeClipboardMock
}));

vi.mock("@/domains/identity/RobotAvatar", () => ({
  RobotAvatar: () => <span aria-label="Robot avatar" />
}));

import { RobotGaragePage } from "@/domains/garage/RobotGaragePage";
import { useGarageStore } from "@/domains/garage/garageStore";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";

const token = "GarageTokenControlsAa0Bb1Cc2Dd3Ee4Ff5Gg6";
let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  downloadRobotTokenBackupMock.mockReset();
  writeClipboardMock.mockReset().mockResolvedValue(undefined);
  useGarageStore.setState({
    slots: [{ ...deriveRobotIdentity(token), nickname: "Patient robot", earnedRewards: 0, robots: {} }],
    currentToken: token,
    hydrated: true
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("Garage robot token controls", () => {
  it("keeps the token out of the DOM while masked and preserves common actions", async () => {
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <RobotGaragePage />
        </MemoryRouter>
      );
    });

    expect(document.body.textContent).toContain("No active trades");
    const recoveryTools = document.querySelector<HTMLDetailsElement>(".garage-identity-tools");
    expect(recoveryTools?.open).toBe(false);
    expect(recoveryTools?.textContent).toContain("Recovery & backup");
    expect(document.querySelector('input[aria-label="Robot token"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain(token);

    await act(async () => {
      recoveryTools?.querySelector("summary")?.click();
    });
    expect(recoveryTools?.open).toBe(true);

    await clickButton("Download Patient robot token backup as JSON");
    await clickButton("Copy token");

    expect(downloadRobotTokenBackupMock).toHaveBeenCalledWith(token, "Patient robot");
    expect(writeClipboardMock).toHaveBeenCalledWith(token);

    await clickButton("Show token");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Robot token"]')?.value).toBe(token);

    await clickButton("Download Patient robot token backup as JSON");
    await clickButton("Copied");
    expect(downloadRobotTokenBackupMock).toHaveBeenCalledTimes(2);
    expect(writeClipboardMock).toHaveBeenCalledTimes(2);

    await clickButton("Hide token");
    expect(document.querySelector('input[aria-label="Robot token"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain(token);

    await clickButton("Show token");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Robot token"]')?.value).toBe(token);

    await act(async () => {
      recoveryTools?.querySelector("summary")?.click();
    });
    expect(recoveryTools?.open).toBe(false);
    expect(document.querySelector('input[aria-label="Robot token"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain(token);

    await act(async () => {
      recoveryTools?.querySelector("summary")?.click();
    });
    expect(findButton("Show token")).toBeDefined();

    const manageTools = document.querySelector<HTMLDetailsElement>(".garage-manage-tools");
    await act(async () => manageTools?.querySelector("summary")?.click());
    expect(manageTools?.open).toBe(true);
    await clickButton("Recover from token");
    expect(manageTools?.open).toBe(false);
    expect(document.body.textContent).toContain("Recover robot");
  });
});

async function clickButton(label: string): Promise<void> {
  const button = findButton(label);
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}

function findButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label ||
      candidate.getAttribute("title") === label ||
      candidate.textContent?.trim() === label
  );
}
