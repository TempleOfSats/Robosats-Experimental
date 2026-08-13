// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/identity/RobotAvatar", () => ({
  RobotAvatar: () => <span aria-label="Robot avatar" />
}));

vi.mock("@/domains/orders/orderRoute", () => ({
  preloadOrderRoute: vi.fn()
}));

import { useFederationStore } from "@/domains/coordinators/federationStore";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { type RobotSlot, useGarageStore } from "@/domains/garage/garageStore";
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
  vi.useRealTimers();
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
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

  it("requires the review screen to settle before enabling offer creation", async () => {
    vi.useFakeTimers();
    useFederationStore.setState({ coordinators: [coordinator] });
    useGarageStore.setState({ slots: [slot], currentToken: slot.token });
    const refreshRobotSlot = vi
      .spyOn(useGarageStore.getState(), "refreshRobotSlot")
      .mockRejectedValue(new Error("Test stopped after submission started."));
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

    await click(stepButton("Amount"));
    await click(stepButton("Review offer"));
    const create = stepButton("Preparing review");
    expect(create.disabled).toBe(true);

    await act(async () => {
      document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(refreshRobotSlot).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(649);
    });
    expect(create.disabled).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(create.disabled).toBe(false);

    await click(create);
    expect(refreshRobotSlot).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Test stopped after submission started.");

    await click(create);
    expect(refreshRobotSlot).toHaveBeenCalledTimes(2);
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

const coordinator = {
  shortAlias: "lake",
  longAlias: "TheBigLake",
  color: "#000000",
  url: "https://coordinator.example",
  avatarUrl: "/lake.webp",
  smallAvatarUrl: "/lake.small.webp",
  badgeIcons: [],
  enabled: true,
  online: true
} satisfies CoordinatorSummary;

const slot: RobotSlot = {
  token: "test-token",
  hashId: "test-hash",
  tokenSHA256: "slot-token",
  nostrPubKey: "nostr-pubkey",
  nostrSecKey: new Uint8Array(32),
  entropyBits: 128,
  hasEnoughEntropy: true,
  shannonEntropy: 4,
  nickname: "ReadyRobot",
  earnedRewards: 0,
  robots: {
    lake: {
      token: "test-token",
      tokenSHA256: "lake-token",
      shortAlias: "lake"
    }
  }
};
