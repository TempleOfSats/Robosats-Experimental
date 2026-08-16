// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotRecord, RobotSlot } from "@/domains/garage/garageStore";

vi.mock("@/domains/rewards/RewardWithdrawalDialog", () => ({
  RewardWithdrawalDialog: () => <div aria-label="Reward claim confirmation">Withdrawal requested</div>
}));

import { RobotCoordinatorDialog, RobotSettingsDialog } from "@/domains/garage/RobotGaragePage";

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("coordinator robot rewards", () => {
  it("keeps the claim result open when the accepted balance becomes zero", async () => {
    await renderCoordinator(rewardRobot, rewardSlot);
    const claimButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "Claim");
    expect(claimButton).toBeDefined();

    await act(async () => {
      claimButton?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(document.body.textContent).toContain("Withdrawal requested"));

    const claimedRobot = { ...rewardRobot, earnedRewards: 0 };
    await renderCoordinator(claimedRobot, {
      ...rewardSlot,
      earnedRewards: 0,
      availableRewards: undefined,
      robots: { temple: claimedRobot }
    });

    expect(document.body.textContent).toContain("Withdrawal requested");
  });
});

describe("released robot orders", () => {
  it("shows the last seen order without presenting it as active", async () => {
    const releasedRobot = { ...rewardRobot, earnedRewards: 0, releasedOrderId: 92620 };
    const releasedSlot = {
      ...rewardSlot,
      earnedRewards: 0,
      availableRewards: undefined,
      robots: { temple: releasedRobot }
    };
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <RobotSettingsDialog
          activeToken={releasedSlot.token}
          coordinators={[coordinator]}
          onClose={vi.fn()}
          onCoordinatorSelect={vi.fn()}
          onTokenBackup={vi.fn()}
          onTokenChange={vi.fn()}
          showKeys={false}
          slot={releasedSlot}
          slots={[releasedSlot]}
          toggleKeys={vi.fn()}
        />
      );
    });

    expect(document.body.textContent).toContain("No active orders · Last seen #92620");
    expect(document.body.textContent).not.toContain("Active order #92620");
    expect(document.body.textContent).not.toContain("Robot management");
  });
});

async function renderCoordinator(robot: RobotRecord, slot: RobotSlot): Promise<void> {
  root ??= createRoot(document.querySelector("#root")!);
  await act(async () => {
    root?.render(
      <RobotCoordinatorDialog coordinator={coordinator} onClose={() => undefined} robot={robot} slot={slot} />
    );
  });
}

const coordinator = {
  shortAlias: "temple",
  longAlias: "Temple of Sats",
  url: "https://coordinator.example",
  color: "#000000",
  avatarUrl: "/fixture-avatar.webp",
  smallAvatarUrl: "/fixture-avatar.webp",
  badgeIcons: [],
  enabled: true,
  online: true
} satisfies CoordinatorSummary;

const rewardRobot = {
  token: "fixture-robot-token",
  shortAlias: "temple",
  earnedRewards: 2_100
} satisfies RobotRecord;

const rewardSlot = {
  token: "fixture-robot-token",
  earnedRewards: 2_100,
  availableRewards: "temple",
  robots: { temple: rewardRobot }
} as unknown as RobotSlot;
