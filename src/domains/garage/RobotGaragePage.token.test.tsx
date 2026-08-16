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

describe("Garage robot controls", () => {
  it("keeps the token private while exposing restrained robot shortcuts", async () => {
    await import("@/domains/garage/RobotTokenBackupDialog");
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <RobotGaragePage />
        </MemoryRouter>
      );
    });

    expect(document.body.textContent).toContain("Ready to trade");
    expect(document.body.textContent).toContain("No active orders");
    expect(document.body.textContent).toContain("Find an offer");
    expect(document.body.textContent).toContain("Guided matching");
    expect(document.body.textContent).toContain("Create an offer");
    expect(document.body.textContent).toContain("Set your own terms");
    expect(document.querySelector(".garage-status-dot")).toBeNull();
    expect(document.body.textContent).toContain("Backup");
    expect(document.body.textContent).toContain("Add");
    expect(document.body.textContent).toContain("Recover");
    expect(document.body.textContent).toContain("Manage");
    expect(document.body.textContent).not.toContain("Recovery & backup");
    expect(document.body.innerHTML).not.toContain(token);

    await clickButton("Switch robot. Current robot: Patient robot");
    expect(document.body.textContent).toContain("Select robot");
    await clickButton("Close robot switcher");

    const operationalStatus = document.querySelector('[role="status"]');
    expect(operationalStatus?.textContent).toContain("Ready to trade");
    expect(operationalStatus?.textContent).toContain("No active orders");
    expect(operationalStatus?.getAttribute("aria-live")).toBe("polite");
    const robotControls = document.querySelector('[role="group"][aria-label="Robot controls"]');
    expect(robotControls).not.toBeNull();
    expect(robotControls?.closest(".garage-robot-hero")).not.toBeNull();

    await clickButton("Backup robot token");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Store your robot token"));
    expect(document.body.innerHTML).toContain(token);

    await clickButton("Download Patient robot token backup as JSON");
    await clickButton("Copy robot token");
    expect(downloadRobotTokenBackupMock).toHaveBeenCalledWith(token, "Patient robot");
    expect(writeClipboardMock).toHaveBeenCalledWith(token);

    await clickButton("Done");
    expect(document.body.innerHTML).not.toContain(token);
    await clickButton("Recover a robot");
    expect(document.body.textContent).toContain("Recover robot");
    await clickButton("Close recovery");

    await clickButton("Manage robot");
    expect(document.body.textContent).toContain("Token backup");
    expect(document.body.textContent).toContain("Recover from token");
  });

  it("lets an existing robot leave the add-robot setup without changing identity", async () => {
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <RobotGaragePage />
        </MemoryRouter>
      );
    });

    await clickButton("Add another robot");
    expect(document.body.textContent).toContain("Add another robot");
    expect(document.body.textContent).not.toContain("Welcome to RoboSats");
    expect(document.body.textContent).toContain("Create a new robot");
    await clickButton("Create my robot");
    expect(document.body.textContent).toContain("Save your recovery token");

    await clickButton("Back to Garage");
    expect(document.body.textContent).toContain("Patient robot");
    expect(useGarageStore.getState().currentToken).toBe(token);
  });

  it("keeps a released robot available and explains where it was last seen", async () => {
    const identity = deriveRobotIdentity(token);
    useGarageStore.setState({
      slots: [
        {
          ...identity,
          nickname: "Patient robot",
          earnedRewards: 0,
          robots: {
            lake: {
              token,
              shortAlias: "lake",
              nostrPubKey: identity.nostrPubKey,
              tokenSHA256: identity.tokenSHA256,
              earnedRewards: 0,
              loading: true,
              releasedOrderId: 92620
            }
          }
        }
      ],
      currentToken: token,
      hydrated: true
    });

    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <RobotGaragePage />
        </MemoryRouter>
      );
    });

    expect(document.body.textContent).toContain("No active orders · Last seen #92620");
    expect(document.body.textContent).toContain("Ready to trade");
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Ready to tradeNo active orders · Last seen #92620"
    );
    expect(document.body.textContent).toContain("Find an offer");
    expect(document.body.textContent).toContain("Create an offer");
  });

  it("keeps an unused robot ready while coordinator checks run", async () => {
    const identity = deriveRobotIdentity(token);
    useGarageStore.setState({
      slots: [
        {
          ...identity,
          nickname: "Patient robot",
          earnedRewards: 0,
          robots: {
            lake: {
              token,
              shortAlias: "lake",
              nostrPubKey: identity.nostrPubKey,
              tokenSHA256: identity.tokenSHA256,
              earnedRewards: 0,
              loading: true
            }
          }
        }
      ],
      currentToken: token,
      hydrated: true
    });

    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <RobotGaragePage />
        </MemoryRouter>
      );
    });

    expect(document.body.textContent).toContain("Ready to trade");
    expect(document.body.textContent).toContain("No active orders · Checking coordinators…");
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Ready to tradeNo active orders · Checking coordinators…"
    );
    expect(document.body.textContent).not.toContain("Checking your robot");
    expect(document.body.textContent).toContain("Find an offer");
    expect(document.body.textContent).toContain("Create an offer");
  });

  it("makes the active trade the only primary next action", async () => {
    const identity = deriveRobotIdentity(token);
    useGarageStore.setState({
      slots: [
        {
          ...identity,
          nickname: "Patient robot",
          earnedRewards: 0,
          activeOrderId: 42,
          lastOrderId: 42,
          robots: {
            lake: {
              token,
              shortAlias: "lake",
              nostrPubKey: identity.nostrPubKey,
              tokenSHA256: identity.tokenSHA256,
              earnedRewards: 0,
              activeOrderId: 42,
              lastOrderId: 42
            }
          }
        }
      ],
      currentToken: token,
      hydrated: true
    });

    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <RobotGaragePage />
        </MemoryRouter>
      );
    });

    const continueTrade = [...document.querySelectorAll<HTMLAnchorElement>("a")].find((link) =>
      link.textContent?.includes("Continue trade")
    );
    expect(continueTrade?.getAttribute("href")).toBe("/order/lake/42");
    expect(document.body.textContent).toContain("Trade in progress");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Trade in progressOrder #42");
    expect(document.body.textContent).not.toContain("Find an offer");
    expect(document.body.textContent).not.toContain("Create an offer");
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
