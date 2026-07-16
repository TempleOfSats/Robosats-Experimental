import { describe, expect, it } from "vitest";
import { messageContainsRobotToken } from "@/domains/chat/chatSafety";

describe("messageContainsRobotToken", () => {
  it("blocks an exact robot token in chat text", () => {
    expect(messageContainsRobotToken("send abcDEF123 to me", "abcDEF123")).toBe(true);
  });

  it("blocks a token pasted across whitespace", () => {
    expect(messageContainsRobotToken("abc\nDEF 123", "abcDEF123")).toBe(true);
  });

  it("allows ordinary chat text", () => {
    expect(messageContainsRobotToken("Payment sent, please check.", "abcDEF123")).toBe(false);
  });
});
