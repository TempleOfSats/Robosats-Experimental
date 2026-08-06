import { beforeEach, describe, expect, it, vi } from "vitest";

const plays = vi.hoisted(() => ({
  chat: vi.fn(async () => true),
  locked: vi.fn(async () => true),
  successful: vi.fn(async () => true),
  taker: vi.fn(async () => true)
}));

vi.mock("@/domains/audio/tradeSounds", () => ({
  playChatOpen: plays.chat,
  playLockedInvoice: plays.locked,
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
      for (const event of ["chat-open", "locked-invoice", "successful", "taker-found"] as const) {
        await playTradeAudio(event);
      }
      expect(plays.chat).toHaveBeenCalledOnce();
      expect(plays.locked).toHaveBeenCalledOnce();
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
