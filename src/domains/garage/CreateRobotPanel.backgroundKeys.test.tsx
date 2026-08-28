// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateRobotPanel } from "@/domains/garage/CreateRobotPanel";
import { useGarageStore } from "@/domains/garage/garageStore";

const mocks = vi.hoisted(() => ({
  generatePgpKeyPair: vi.fn(),
  prewarmRobotAvatar: vi.fn()
}));

vi.mock("@/domains/crypto/pgp", () => ({
  generatePgpKeyPair: mocks.generatePgpKeyPair
}));
vi.mock("@/domains/identity/roboavatarClient", () => ({
  prewarmRobotAvatar: mocks.prewarmRobotAvatar
}));
vi.mock("@/domains/identity/robonameClient", () => ({
  generateRoboname: () => "Test Robot"
}));
vi.mock("@/domains/identity/RobotAvatar", () => ({
  RobotAvatar: () => <span aria-label="Robot avatar" />
}));

const testToken = "test-only-background-keys-Aa0Bb1Cc2Dd3Ee4Ff5Gg6";
let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  localStorage.clear();
  useGarageStore.setState({ slots: [], currentToken: "", hydrated: true });
  mocks.generatePgpKeyPair.mockReset().mockResolvedValue({
    publicKeyArmored: "generated-public-key",
    encryptedPrivateKeyArmored: "generated-private-key"
  });
  mocks.prewarmRobotAvatar.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("CreateRobotPanel background key generation", () => {
  it("returns to an inline caller after robot setup completes", async () => {
    const onComplete = vi.fn();

    await createRobot(onComplete);

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("does not restore a Fleet key through the standard robot path", async () => {
    await renderPanel();
    await clickButton("Restore an existing robot");
    await enterToken("rsgarage1fleetkey");
    await clickButton("Continue to identity");

    expect(document.body.textContent).toContain("This is a Fleet recovery key. Restore it from Pro Desk.");
    expect(useGarageStore.getState().slots).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Enter my Garage");
  });

  it("does not derive keys after the new robot is removed during the delay", async () => {
    await createRobot();
    useGarageStore.getState().removeSlot(testToken);

    await runBackgroundDelay();

    expect(mocks.generatePgpKeyPair).not.toHaveBeenCalled();
  });

  it("does not derive keys after a foreground refresh has already supplied them", async () => {
    await createRobot();
    useGarageStore.getState().updateSlotIdentityDetails(testToken, {
      keys: { pubKey: "foreground-public-key", encPrivKey: "foreground-private-key" }
    });

    await runBackgroundDelay();

    expect(mocks.generatePgpKeyPair).not.toHaveBeenCalled();
  });
});

async function createRobot(onComplete?: () => void): Promise<void> {
  await renderPanel(onComplete);

  await clickButton("Restore an existing robot");
  await enterToken(testToken);
  await clickButton("Continue to identity");
  await clickButton("Enter my Garage");
  expect(useGarageStore.getState().slots.some((slot) => slot.token === testToken)).toBe(true);
}

async function renderPanel(onComplete?: () => void): Promise<void> {
  root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <CreateRobotPanel onComplete={onComplete} />
      </MemoryRouter>
    );
  });
}

async function enterToken(token: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Robot token"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, token);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(label: string): Promise<void> {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}

async function runBackgroundDelay(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
    await Promise.resolve();
  });
}
