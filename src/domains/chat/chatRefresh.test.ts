import { describe, expect, it } from "vitest";
import { chatPollDelayMs, chatReconnectDelayMs } from "@/domains/chat/chatRefresh";

describe("chat refresh timing", () => {
  it("keeps REST reconciliation active while the socket is open", () => {
    expect(chatPollDelayMs(true, false, () => 0.5)).toBe(60_000);
    expect(chatPollDelayMs(false, false, () => 0.5)).toBe(8_000);
    expect(chatPollDelayMs(false, true, () => 0.5)).toBe(120_000);
  });

  it("backs off reconnects without stopping permanently", () => {
    expect(chatReconnectDelayMs(1, () => 0.5)).toBe(1_500);
    expect(chatReconnectDelayMs(2, () => 0.5)).toBe(3_000);
    expect(chatReconnectDelayMs(6, () => 0.5)).toBe(30_000);
    expect(chatReconnectDelayMs(20, () => 0.5)).toBe(30_000);
  });
});
