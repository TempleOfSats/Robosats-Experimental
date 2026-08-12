import { beforeEach, describe, expect, it, vi } from "vitest";

const plays = vi.hoisted(() => ({
  cancelled: vi.fn(async () => true),
  chat: vi.fn(async () => true),
  collabCancelled: vi.fn(async () => true),
  disputeOpened: vi.fn(async () => true),
  locked: vi.fn(async () => true),
  paused: vi.fn(async () => true),
  resumed: vi.fn(async () => true),
  rewardWithdrawal: vi.fn(async () => true),
  successful: vi.fn(async () => true),
  taker: vi.fn(async () => true)
}));

vi.mock("@/domains/audio/tradeSounds", () => ({
  playChatOpen: plays.chat,
  playLockedInvoice: plays.locked,
  playOrderCancelled: plays.cancelled,
  playOrderCollabCancelled: plays.collabCancelled,
  playOrderDisputeOpened: plays.disputeOpened,
  playOrderPaused: plays.paused,
  playOrderResumed: plays.resumed,
  playRewardsWithdrawalSuccess: plays.rewardWithdrawal,
  playSuccessful: plays.successful,
  playTakerFound: plays.taker
}));

describe("audio controller", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(plays).forEach((play) => play.mockClear());
  });

  it("dispatches every event to its procedural recipe", async () => {
    const windowValue = globalThis.window;
    Object.assign(globalThis, { window: {} });
    try {
      const { playTradeAudio } = await import("./audioController");
      for (const event of [
        "chat-open",
        "locked-invoice",
        "order-cancelled",
        "order-collab-cancelled",
        "order-dispute-opened",
        "order-paused",
        "order-resumed",
        "rewards-withdrawal-success",
        "successful",
        "taker-found"
      ] as const) {
        await playTradeAudio(event);
      }
      expect(plays.cancelled).toHaveBeenCalledOnce();
      expect(plays.chat).toHaveBeenCalledOnce();
      expect(plays.collabCancelled).toHaveBeenCalledOnce();
      expect(plays.disputeOpened).toHaveBeenCalledOnce();
      expect(plays.locked).toHaveBeenCalledOnce();
      expect(plays.paused).toHaveBeenCalledOnce();
      expect(plays.resumed).toHaveBeenCalledOnce();
      expect(plays.rewardWithdrawal).toHaveBeenCalledOnce();
      expect(plays.successful).toHaveBeenCalledOnce();
      expect(plays.taker).toHaveBeenCalledOnce();
    } finally {
      Object.assign(globalThis, { window: windowValue });
    }
  });

  it("is a no-op during SSR", async () => {
    const windowValue = globalThis.window;
    Object.assign(globalThis, { window: undefined });
    try {
      const { playTradeAudio } = await import("./audioController");
      await expect(playTradeAudio("chat-open")).resolves.toBeUndefined();
      expect(plays.chat).not.toHaveBeenCalled();
    } finally {
      Object.assign(globalThis, { window: windowValue });
    }
  });
});
