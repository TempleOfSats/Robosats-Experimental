import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { type RobotSlot, useGarageStore } from "@/domains/garage/garageStore";
import { ingestCoordinatorOrder, resetCoordinatorOrderActivityForTests } from "@/domains/orders/orderActivity";
import type { OrderDto } from "@/domains/orders/order.types";
import {
  startDisputeRewardRefreshRuntime,
  stopDisputeRewardRefreshRuntimeForTests
} from "@/domains/rewards/disputeRewardRefresh";

const refreshRobotSlot = vi.fn();

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  stopDisputeRewardRefreshRuntimeForTests();
  resetCoordinatorOrderActivityForTests();
  refreshRobotSlot.mockReset();
  refreshRobotSlot.mockResolvedValue({
    slotId: slot.tokenSHA256,
    coordinators: [{ shortAlias: coordinator.shortAlias }]
  });
  useGarageStore.setState({ slots: [slot], hydrated: true, refreshRobotSlot });
  useFederationStore.setState({ coordinators: [coordinator] });
});

afterEach(() => {
  stopDisputeRewardRefreshRuntimeForTests();
  resetCoordinatorOrderActivityForTests();
  vi.unstubAllGlobals();
});

describe("dispute reward refresh", () => {
  it("refreshes the winning robot once with background priority", async () => {
    startDisputeRewardRefreshRuntime();
    observe({ status: 18, is_maker: true, is_taker: false });
    observe({ status: 18, is_maker: true, is_taker: false });

    await vi.waitFor(() => expect(refreshRobotSlot).toHaveBeenCalledOnce());
    expect(refreshRobotSlot).toHaveBeenCalledWith(slot.token, [coordinator], {
      maxAgeMs: 0,
      preferredAliases: ["lake"],
      priority: "background",
      source: "robot-refresh",
      supersedeInFlight: true
    });
  });

  it("does not refresh for the robot that lost", () => {
    startDisputeRewardRefreshRuntime();
    observe({ status: 17, is_maker: true, is_taker: false });
    expect(refreshRobotSlot).not.toHaveBeenCalled();
  });

  it("allows a later observation to retry after a transport failure", async () => {
    refreshRobotSlot
      .mockResolvedValueOnce({
        slotId: slot.tokenSHA256,
        coordinators: [{ shortAlias: "lake", transportFailed: true }]
      })
      .mockResolvedValueOnce({
        slotId: slot.tokenSHA256,
        coordinators: [{ shortAlias: "lake" }]
      });
    startDisputeRewardRefreshRuntime();
    observe({ status: 18, is_maker: true, is_taker: false });
    await vi.waitFor(() => expect(refreshRobotSlot).toHaveBeenCalledOnce());
    await Promise.resolve();
    await Promise.resolve();

    observe({ status: 18, is_maker: true, is_taker: false });
    await vi.waitFor(() => expect(refreshRobotSlot).toHaveBeenCalledTimes(2));
  });

  it("allows a later observation to retry when the coordinator returned no result", async () => {
    refreshRobotSlot.mockResolvedValueOnce({ slotId: slot.tokenSHA256, coordinators: [] }).mockResolvedValueOnce({
      slotId: slot.tokenSHA256,
      coordinators: [{ shortAlias: "lake" }]
    });
    startDisputeRewardRefreshRuntime();
    observe({ status: 18, is_maker: true, is_taker: false });
    await vi.waitFor(() => expect(refreshRobotSlot).toHaveBeenCalledOnce());
    await Promise.resolve();
    await Promise.resolve();

    observe({ status: 18, is_maker: true, is_taker: false });
    await vi.waitFor(() => expect(refreshRobotSlot).toHaveBeenCalledTimes(2));
  });
});

function observe(overrides: Partial<OrderDto>): void {
  ingestCoordinatorOrder({
    order: {
      id: 42,
      status: 16,
      is_maker: true,
      is_taker: false,
      ...overrides
    } as OrderDto,
    shortAlias: "lake",
    slot
  });
}

const coordinator = {
  shortAlias: "lake",
  longAlias: "The Big Lake",
  color: "#1976d2",
  url: "https://lake.example",
  avatarUrl: "/lake.webp",
  smallAvatarUrl: "/lake-small.webp",
  badgeIcons: [],
  enabled: true,
  online: true
} satisfies CoordinatorSummary;

const slot = {
  token: "robot-token-with-enough-entropy",
  hashId: "robot-hash",
  tokenSHA256: "slot-id",
  nostrPubKey: "nostr-public",
  nostrSecKey: new Uint8Array(32),
  entropyBits: 216,
  hasEnoughEntropy: true,
  shannonEntropy: 5,
  nickname: "Robot",
  earnedRewards: 0,
  robots: {
    lake: {
      token: "robot-token-with-enough-entropy",
      tokenSHA256: "slot-id",
      shortAlias: "lake"
    }
  }
} satisfies RobotSlot;
