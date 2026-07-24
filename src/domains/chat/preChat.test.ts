import { describe, expect, it } from "vitest";
import {
  coordinatorSupportsPreChat,
  hasSentPreChatMessage,
  shouldOfferPreChat,
  visiblePreChatMessages
} from "@/domains/chat/preChat";

describe("pre-chat capability", () => {
  it("requires an explicit coordinator capability", () => {
    expect(coordinatorSupportsPreChat()).toBe(false);
    expect(coordinatorSupportsPreChat({ features: {} })).toBe(false);
    expect(coordinatorSupportsPreChat({ features: { pre_chat: false } })).toBe(false);
    expect(coordinatorSupportsPreChat({ features: { pre_chat: true } })).toBe(true);
  });

  it("offers pre-chat only while both setup inputs are outstanding", () => {
    expect(shouldOfferPreChat(6, { features: { pre_chat: true } })).toBe(true);
  });

  it.each([1, 3, 7, 8, 9, 11, 14])("does not offer pre-chat during status %i", (status) => {
    expect(shouldOfferPreChat(status, { features: { pre_chat: true } })).toBe(false);
  });

  it("keeps peer messages hidden until normal chat opens", () => {
    const mine = { index: 1, mine: true };
    const peer = { index: 2, mine: false };

    expect(visiblePreChatMessages([peer, mine])).toEqual([mine]);
  });

  it("detects whether this robot already used its one early message", () => {
    expect(hasSentPreChatMessage([{ mine: false }])).toBe(false);
    expect(hasSentPreChatMessage([{ mine: false }, { mine: true }])).toBe(true);
  });
});
