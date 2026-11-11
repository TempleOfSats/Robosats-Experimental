import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unwrapEvent } from "nostr-tools/nip59";
import { generateSecretKey, getPublicKey, verifyEvent, type Event } from "nostr-tools/pure";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { publishChatMessageToRelay } from "./chatRelay";

const mocks = vi.hoisted(() => ({ ensureRelay: vi.fn(), publish: vi.fn() }));
vi.mock("@/domains/nostr/sharedRelayPool", () => ({ getSharedRelayPool: () => ({ ensureRelay: mocks.ensureRelay }) }));

const token = "synthetic-chat-relay-test-identity";
const own = deriveRobotIdentity(token);
const peerSecret = generateSecretKey();
const params = {
  content: "Synthetic test message",
  baseUrl: "http://coordinator.example",
  shortAlias: "test",
  orderId: 123,
  token,
  ownPublicKey: own.nostrPubKey,
  peerPublicKey: getPublicKey(peerSecret)
};

beforeEach(() => {
  mocks.publish.mockReset().mockResolvedValue("");
  mocks.ensureRelay.mockReset().mockResolvedValue({ publish: mocks.publish });
});
afterEach(() => vi.useRealTimers());

describe("upstream NIP-17 chat delivery", () => {
  it("publishes encrypted, signed peer and sender copies with upstream's order tags", async () => {
    await publishChatMessageToRelay(params);
    expect(mocks.ensureRelay).toHaveBeenCalledWith("ws://coordinator.example/relay/", expect.any(Object));
    const envelopes = mocks.publish.mock.calls.map(([event]) => event as Event);
    expect(envelopes).toHaveLength(2);
    envelopes.forEach((event) => {
      expect(verifyEvent(event)).toBe(true);
      expect(event.kind).toBe(1059);
      expect(JSON.stringify(event)).not.toContain(params.content);
    });
    const peerCopy = unwrapEvent(envelopes[0], peerSecret);
    expect(peerCopy).toMatchObject({ kind: 14, content: params.content, pubkey: own.nostrPubKey });
    expect(peerCopy.tags).toEqual([
      ["order_id", "test/123"],
      ["p", params.peerPublicKey, "ws://coordinator.example/relay/"],
      ["p", params.ownPublicKey, "ws://coordinator.example/relay/"]
    ]);
    expect(unwrapEvent(envelopes[1], own.nostrSecKey)).toEqual(peerCopy);
  });

  it("also wraps image metadata as a kind-14 payload supported by upstream", async () => {
    const content = JSON.stringify({ type: "image", synthetic: true });
    await publishChatMessageToRelay({ ...params, content });
    expect(unwrapEvent(mocks.publish.mock.calls[0][0], peerSecret).content).toBe(content);
  });

  it("rejects mismatched robot identities without sending", async () => {
    await expect(publishChatMessageToRelay({ ...params, ownPublicKey: params.peerPublicKey })).rejects.toThrow(
      "identity"
    );
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("does not mistake connection or acknowledgement failures for delivery", async () => {
    mocks.ensureRelay.mockRejectedValueOnce(new Error("offline"));
    await expect(publishChatMessageToRelay(params)).rejects.toThrow("offline");
    mocks.publish.mockRejectedValueOnce(new Error("rejected"));
    await expect(publishChatMessageToRelay(params)).rejects.toThrow("rejected");
  });

  it("bounds missing acknowledgements and can recover on the next send", async () => {
    vi.useFakeTimers();
    mocks.publish.mockImplementation(() => new Promise(() => undefined));
    const result = expect(publishChatMessageToRelay(params)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(20_000);
    await result;
    mocks.publish.mockResolvedValue("");
    await expect(publishChatMessageToRelay(params)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not publish after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(publishChatMessageToRelay({ ...params, signal: controller.signal })).rejects.toThrow();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("cancels an in-flight acknowledgement without waiting for its timeout", async () => {
    vi.useFakeTimers();
    mocks.publish.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const result = expect(publishChatMessageToRelay({ ...params, signal: controller.signal })).rejects.toThrow(
      "cancelled"
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
