import { describe, expect, it, vi } from "vitest";
import { claimReward, normalizeClaimRewardResponse } from "@/domains/rewards/rewardApi";
import type { ApiClient, Auth } from "@/domains/transport/apiClient";

const auth: Auth = { tokenSHA256: "robot-token" };

describe("rewardApi", () => {
  it("normalizes successful withdrawal responses", () => {
    expect(normalizeClaimRewardResponse({ successful_withdrawal: "true" })).toEqual({
      successfulWithdrawal: true
    });
  });

  it("posts signed invoices with the current reward field names", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ successful_withdrawal: true }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await expect(claimReward("https://coordinator", "signed", 1000, auth, client)).resolves.toEqual({
      successfulWithdrawal: true
    });

    expect(client.post).toHaveBeenCalledWith(
      "https://coordinator",
      "/api/reward/",
      {
        invoice: "signed",
        routing_budget_ppm: 1000
      },
      auth
    );
  });

  it("omits the optional routing budget for the current claim flow", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ successful_withdrawal: true }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await claimReward("https://coordinator", "signed", 0, auth, client);

    expect(client.post).toHaveBeenCalledWith(
      "https://coordinator",
      "/api/reward/",
      { invoice: "signed" },
      auth
    );
  });
});
