// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGarageStore } from "@/domains/garage/garageStore";
import { RobotGaragePage } from "@/domains/garage/RobotGaragePage";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { encodeGarageToken } from "@/domains/pro/garageVault";
import { defaultProPreferences, useProPreferencesStore } from "@/domains/pro/proPreferencesStore";

vi.mock("@/domains/identity/RobotAvatar", () => ({
  RobotAvatar: () => <span aria-label="Robot avatar" />
}));

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  useGarageStore.setState({ slots: [], currentToken: "", hydrated: true });
  useProPreferencesStore.setState(defaultProPreferences);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("normal Garage Fleet recovery", () => {
  it("offers a Pro Mode handoff and prefills the existing Fleet recovery dialog", async () => {
    await import("@/domains/pro/GarageRecoveryDialog");
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <RobotGaragePage />
        </MemoryRouter>
      );
    });

    const fleetKey = encodeGarageToken(new Uint8Array(32).fill(7));
    const tokenInput = document.querySelector<HTMLInputElement>('input[aria-label="Robot token"]')!;
    await setInputValue(tokenInput, fleetKey);
    await clickButton("Continue");

    expect(document.body.textContent).toContain("Restore a Pro Robot Fleet?");
    expect(document.body.textContent).toContain("not a single-robot token");
    expect(useProPreferencesStore.getState().enabled).toBe(false);

    await clickButton("Continue to Fleet recovery");
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLInputElement>(".pro-fleet-key-input input")?.value).toBe(fleetKey);
    });
    expect(useProPreferencesStore.getState().enabled).toBe(false);
  });

  it("recovers a Fleet-derived robot into the normal Garage", async () => {
    const existingToken = "ExistingGarageRobotTokenAa0Bb1Cc2Dd3Ee4";
    const recoveredToken = "RecoveredFleetRobotTokenFf5Gg6Hh7Ii8Jj9";
    const existingIdentity = deriveRobotIdentity(existingToken);
    const recoveredIdentity = deriveRobotIdentity(recoveredToken);
    useGarageStore.setState({
      slots: [
        {
          ...existingIdentity,
          nickname: "Existing robot",
          earnedRewards: 0,
          robots: {}
        },
        {
          ...recoveredIdentity,
          nickname: "Fleet robot",
          managedBy: "fleet",
          earnedRewards: 0,
          robots: {}
        }
      ],
      currentToken: existingToken,
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

    await act(async () => document.querySelector<HTMLElement>(".garage-manage-tools summary")?.click());
    await clickButton("Recover from token");
    const tokenInput = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Paste your token"]')!;
    await setInputValue(tokenInput, recoveredToken);
    await clickButton("Recover robot");

    const recovered = useGarageStore.getState().slots.find((slot) => slot.token === recoveredToken);
    expect(recovered?.managedBy).toBeUndefined();
    expect(useGarageStore.getState().currentToken).toBe(recoveredToken);
    expect(document.body.textContent).toContain(recovered?.nickname);
  });
});

async function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(label: string): Promise<void> {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}
