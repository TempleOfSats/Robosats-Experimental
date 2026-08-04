import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { DisputeRewardClaim } from "@/domains/orders/OrderPage";
import type { OrderDto } from "@/domains/orders/order.types";

describe("dispute reward action", () => {
  it("never exposes a live withdrawal from a trade preview", () => {
    const html = renderToStaticMarkup(
      <DisputeRewardClaim
        coordinator={rewardCoordinator}
        order={winningDispute}
        previewMode
        shortAlias="temple"
        slot={rewardSlot}
      />
    );

    expect(html).toBe("");
  });

  it("describes the coordinator balance without attributing it to one dispute", () => {
    const html = renderToStaticMarkup(
      <DisputeRewardClaim
        coordinator={rewardCoordinator}
        order={winningDispute}
        previewMode={false}
        shortAlias="temple"
        slot={rewardSlot}
      />
    );

    expect(html).toContain("View 2,100 sats in robot rewards");
    expect(html).not.toContain("Claim 2,100 sats");
  });
});

const rewardCoordinator = {
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
