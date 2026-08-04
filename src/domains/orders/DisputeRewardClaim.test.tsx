// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotSlot } from "@/domains/garage/garageStore";
import type { OrderDto } from "@/domains/orders/order.types";

vi.mock("@/domains/rewards/RewardWithdrawalDialog", () => ({
  RewardWithdrawalDialog: () => <div role="dialog">Fixture reward dialog</div>
}));

import { DisputeRewardClaim } from "@/domains/orders/OrderPage";

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

describe("dispute reward claim", () => {
  it("closes an open live claim when the trade becomes a preview", async () => {
    await renderClaim(false);
    const openButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("View 2,100 sats")
    );
    expect(openButton).toBeDefined();

    await act(async () => {
      openButton?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());

    await renderClaim(true);

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("View 2,100 sats");
  });
});

async function renderClaim(previewMode: boolean): Promise<void> {
  root ??= createRoot(document.querySelector("#root")!);
  await act(async () => {
    root?.render(
      <DisputeRewardClaim
        coordinator={coordinator}
        order={winningDispute}
        previewMode={previewMode}
        shortAlias="temple"
        slot={rewardSlot}
      />
    );
  });
}

const coordinator = {
  shortAlias: "temple",
  url: "https://coordinator.example"
} as CoordinatorSummary;

const rewardSlot = {
  token: "fixture-robot-token",
  robots: { temple: { shortAlias: "temple", earnedRewards: 2_100 } }
} as unknown as RobotSlot;

const winningDispute = {
  status: 18,
  is_maker: true,
  is_taker: false
} as OrderDto;
