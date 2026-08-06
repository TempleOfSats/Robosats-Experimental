import { describe, expect, it } from "vitest";
import {
  coordinatorSupportsPreChat,
  hasSentPreChatMessage,
  isOwnChatMessage,
  shouldOfferPreChat,
  usablePeerPublicKey,
  visiblePreChatMessages
} from "@/domains/chat/preChat";

describe("pre-chat capability", () => {
  it("requires an explicit coordinator capability", () => {
    expect(coordinatorSupportsPreChat()).toBe(false);
    expect(coordinatorSupportsPreChat({ features: {} })).toBe(false);
    expect(coordinatorSupportsPreChat({ features: { pre_chat: false } })).toBe(false);
    expect(coordinatorSupportsPreChat({ features: { pre_chat: true } })).toBe(true);
  });

  it("offers pre-chat during the buyer and seller setup windows", () => {
    const enabled = { features: { pre_chat: true } };
    expect(shouldOfferPreChat(6, enabled, { is_buyer: true })).toBe(true);
    expect(shouldOfferPreChat(8, enabled, { is_buyer: true })).toBe(true);
    expect(shouldOfferPreChat(6, enabled, { is_seller: true })).toBe(true);
    expect(shouldOfferPreChat(7, enabled, { is_seller: true })).toBe(true);
  });

  it("requires a known role and rejects unsupported status/capability combinations", () => {
    const enabled = { features: { pre_chat: true } };
    expect(shouldOfferPreChat(6, enabled)).toBe(false);
    expect(shouldOfferPreChat(7, enabled, { is_buyer: true })).toBe(false);
    expect(shouldOfferPreChat(8, enabled, { is_seller: true })).toBe(false);
    expect(shouldOfferPreChat(8, { features: { pre_chat: false } }, { is_buyer: true })).toBe(false);
    expect(shouldOfferPreChat(9, enabled, { is_buyer: true })).toBe(false);
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

  it("treats sender-filtered pre-chat history as mine despite a local display-name difference", () => {
    expect(isOwnChatMessage("CoordinatorRobot", "Fleet display name", true)).toBe(true);
    expect(isOwnChatMessage("CoordinatorRobot", "Fleet display name", false)).toBe(false);
    expect(isOwnChatMessage("CoordinatorRobot", "CoordinatorRobot", false)).toBe(true);
  });

  it("accepts only a peer public key that differs from this robot's key", () => {
    const ownKey = "-----BEGIN PGP PUBLIC KEY BLOCK-----\nown\n-----END PGP PUBLIC KEY BLOCK-----";
    const peerKey = "-----BEGIN PGP PUBLIC KEY BLOCK-----\npeer\n-----END PGP PUBLIC KEY BLOCK-----";

    expect(usablePeerPublicKey(peerKey, ownKey)).toBe(peerKey);
    expect(usablePeerPublicKey(`${ownKey}\n`, ownKey)).toBe("");
    expect(usablePeerPublicKey("not a key", ownKey)).toBe("");
  });
});
