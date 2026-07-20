import { describe, expect, it } from "vitest";
import { chatPollDelayMs, chatReconnectDelayMs } from "@/domains/chat/chatRefresh";

describe("chat refresh timing", () => {
  it("keeps REST reconciliation active while the socket is open", () => {
    expect(chatPollDelayMs(true)).toBe(15_000);
    expect(chatPollDelayMs(false)).toBe(8_000);
  });

  it("backs off reconnects without stopping permanently", () => {
    expect(chatReconnectDelayMs(1)).toBe(1_500);
    expect(chatReconnectDelayMs(2)).toBe(3_000);
    expect(chatReconnectDelayMs(6)).toBe(30_000);
    expect(chatReconnectDelayMs(20)).toBe(30_000);
  });
});
