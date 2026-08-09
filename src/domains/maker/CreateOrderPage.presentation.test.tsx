// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/identity/RobotAvatar", () => ({
  RobotAvatar: () => <span aria-label="Robot avatar" />
}));

import { useFederationStore } from "@/domains/coordinators/federationStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import { CreateOrderPage } from "@/domains/maker/CreateOrderPage";
import { usePortableSettingsStore } from "@/domains/pro/portableSettingsStore";
import { defaultProPreferences, useProPreferencesStore } from "@/domains/pro/proPreferencesStore";

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  useFederationStore.setState({ coordinators: [] });
  useGarageStore.setState({
    slots: [],
    currentToken: undefined,
    hydrated: true,
    hydrate: vi.fn()
  });
  usePortableSettingsStore.setState({ manifest: undefined });
  useProPreferencesStore.setState(defaultProPreferences);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("Create order presentation", () => {
  it("presents review as a summary and marks backward and forward step changes", async () => {
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/create",
              state: {
                prefillDraft: {
                  amount: "250",
                  currency: 1,
                  paymentMethod: "Wise",
                  type: 0
                }
              }
            }
          ]}
        >
          <CreateOrderPage />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    expect(document.querySelector('.maker-step-frame-forward[data-step="review"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Offer summary");
    expect(document.body.textContent).toContain("Review before publishing");
    expect(stepButton("Review").getAttribute("aria-current")).toBe("step");

    await click(stepButton("Amount"));
    expect(document.querySelector('.maker-step-frame-backward[data-step="amount"]')).not.toBeNull();
    expect(stepButton("Amount").getAttribute("aria-current")).toBe("step");

    await click(stepButton("Review offer"));
    expect(document.querySelector('.maker-step-frame-forward[data-step="review"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Wise");
  });
});

function stepButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
  expect(button).toBeDefined();
  return button!;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}
