// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setupPortal = vi.hoisted(() => {
  let resolve!: (module: { QuickRobotSetupPortal: () => null }) => void;
  const promise = new Promise<{ QuickRobotSetupPortal: () => null }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
});

vi.mock("@/domains/garage/QuickRobotSetupPortal", () => setupPortal.promise);

import { useGarageStore } from "@/domains/garage/garageStore";
import { CreateOrderPage } from "@/domains/maker/CreateOrderPage";
import { defaultProPreferences, useProPreferencesStore } from "@/domains/pro/proPreferencesStore";

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  useGarageStore.setState({ slots: [], currentToken: undefined, hydrated: true, hydrate: vi.fn() });
  useProPreferencesStore.setState(defaultProPreferences);
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  setupPortal.resolve({ QuickRobotSetupPortal: () => null });
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("Create order robot setup loading", () => {
  it("shows immediate feedback that remains dismissible while the setup chunk loads", async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <CreateOrderPage />
        </MemoryRouter>
      );
    });

    const createRobot = buttonWithText("Create robot");
    await act(async () => createRobot.click());

    expect(document.body.textContent).toContain("Preparing robot setup");
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close robot setup"]');
    expect(close).not.toBeNull();

    await act(async () => close?.click());
    expect(document.body.textContent).not.toContain("Preparing robot setup");
  });
});

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}
