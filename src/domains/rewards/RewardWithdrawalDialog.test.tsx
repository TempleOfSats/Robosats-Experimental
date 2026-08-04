// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { type RobotSlot, useGarageStore } from "@/domains/garage/garageStore";

vi.mock("@/domains/rewards/RewardWithdrawalPanel", () => ({
  RewardWithdrawalPanel: ({ onClaimed }: { onClaimed: (shortAlias: string) => void }) => (
    <button onClick={() => onClaimed("temple")} type="button">
      Submit fixture claim
    </button>
  )
}));

import { RewardWithdrawalDialog } from "@/domains/rewards/RewardWithdrawalDialog";

const initialGarageState = useGarageStore.getState();
let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  useGarageStore.setState(initialGarageState, true);
  document.body.innerHTML = "";
});

describe("reward withdrawal dialog", () => {
  it("keeps a missing reward coordinator actionable instead of rendering an empty dialog", async () => {
    await renderDialog([], rewardSlot);

    expect(document.body.textContent).toContain("Reward details unavailable");
    expect(document.body.textContent).toContain("Refresh the coordinator list, then try again.");
    expect(document.body.textContent).toContain("Retry");
  });

  it("confirms success, clears the accepted balance and starts a post-event read", async () => {
    const refreshRobotSlot = vi.fn().mockResolvedValue({
      slotId: "slot-id",
      coordinators: [{ shortAlias: "temple" }]
    });
    useGarageStore.setState({
      slots: [rewardSlot],
      currentToken: rewardSlot.token,
      hydrated: true,
      refreshRobotSlot
    });
    await renderDialog([coordinator], rewardSlot);

    await click("Submit fixture claim");

    expect(document.body.textContent).toContain("Withdrawal requested");
    expect(document.body.textContent).toContain("Robot balance updated.");
    expect(useGarageStore.getState().slots[0].earnedRewards).toBe(0);
    expect(refreshRobotSlot).toHaveBeenCalledWith(rewardSlot.token, [coordinator], {
      maxAgeMs: 0,
      preferredAliases: ["temple"],
      priority: "background",
      source: "robot-refresh",
      supersedeInFlight: true
    });
  });

  it("keeps an accepted withdrawal distinct from a failed balance refresh", async () => {
    useGarageStore.setState({
      slots: [rewardSlot],
      currentToken: rewardSlot.token,
      hydrated: true,
      refreshRobotSlot: vi.fn().mockRejectedValue(new Error("offline"))
    });
    await renderDialog([coordinator], rewardSlot);

    await click("Submit fixture claim");

    expect(document.body.textContent).toContain("Withdrawal requested");
    expect(document.body.textContent).toContain("The latest balance could not be checked yet.");
    expect(document.body.textContent).toContain("Retry balance");
  });
});

async function renderDialog(coordinators: CoordinatorSummary[], slot: RobotSlot): Promise<void> {
  root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root?.render(<RewardWithdrawalDialog coordinators={coordinators} onClose={() => undefined} slot={slot} />);
  });
}

async function click(label: string): Promise<void> {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

const coordinator = {
  shortAlias: "temple",
  url: "https://coordinator.example"
} as CoordinatorSummary;

const rewardSlot = {
  token: "fixture-robot-token",
  tokenSHA256: "slot-id",
  earnedRewards: 2_100,
  robots: { temple: { shortAlias: "temple", earnedRewards: 2_100 } }
} as unknown as RobotSlot;
