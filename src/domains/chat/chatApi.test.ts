import { describe, expect, it, vi } from "vitest";
import {
  escapeChatPayload,
  fetchChatMessages,
  isDisplayableChatPayload,
  normalizeChatResponse,
  normalizePeerConnected,
  postChatMessage
} from "@/domains/chat/chatApi";
import type { ApiClient, Auth } from "@/domains/transport/apiClient";

const auth: Auth = { tokenSHA256: "robot-token" };

describe("chatApi", () => {
  it("normalizes current chat response fields", () => {
    expect(
      normalizeChatResponse({
        peer_connected: "true",
        peer_pubkey: "-----BEGIN PGP PUBLIC KEY BLOCK-----\\\\peer\\key",
        messages: [
          { index: "2", time: "2026-07-06T00:00:00Z", message: "-----BEGIN PGP MESSAGE-----\\armored", nick: "Robot" }
        ]
      })
    ).toEqual({
      peerConnected: true,
      peerPubkey: "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\npeer\nkey",
      messages: [
        {
          index: 2,
          time: "2026-07-06T00:00:00Z",
          encryptedMessage: "-----BEGIN PGP MESSAGE-----\narmored",
          nick: "Robot"
        }
      ]
    });
  });

  it("leaves non-PGP chat messages unchanged while normalizing current response fields", () => {
    expect(
      normalizeChatResponse({
        peer_connected: true,
        peer_pubkey: "",
        messages: [{ index: 1, message: "# payment reference \\ stays literal", nick: "Robot" }]
      }).messages[0]?.encryptedMessage
    ).toBe("# payment reference \\ stays literal");
  });

  it("does not treat a missing or unknown presence field as offline", () => {
    expect(normalizeChatResponse({ messages: [] }).peerConnected).toBeUndefined();
    expect(normalizeChatResponse({ peer_connected: "unknown", messages: [] }).peerConnected).toBeUndefined();
    expect(normalizeChatResponse({ peer_connected: false, messages: [] }).peerConnected).toBe(false);
  });

  it("normalizes all explicit coordinator presence forms", () => {
    expect([true, "true", 1, "1"].map(normalizePeerConnected)).toEqual([true, true, true, true]);
    expect([false, "false", 0, "0"].map(normalizePeerConnected)).toEqual([false, false, false, false]);
    expect(normalizePeerConnected(null)).toBeUndefined();
  });

  it("distinguishes chat content from WebSocket presence controls", () => {
    expect(isDisplayableChatPayload("-----BEGIN PGP MESSAGE-----\narmored")).toBe(true);
    expect(isDisplayableChatPayload("# payment reference")).toBe(true);
    expect(isDisplayableChatPayload("peer-disconnected")).toBe(false);
    expect(isDisplayableChatPayload("-----BEGIN PGP PUBLIC KEY BLOCK-----\nkey")).toBe(false);
  });

  it("fetches chat messages with order id and offset", async () => {
    const client = {
      get: vi.fn().mockResolvedValue({ messages: [] }),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await fetchChatMessages("https://coordinator", 123, 4, auth, client);

    expect(client.get).toHaveBeenCalledWith("https://coordinator", "/api/chat/?order_id=123&offset=4", auth, {
      timeoutProfile: "background",
      priority: "background",
      source: "chat"
    });
  });

  it("posts encrypted chat messages with current field names", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ messages: [] }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await postChatMessage("https://coordinator", 123, "-----BEGIN PGP MESSAGE-----\nbody", 4, auth, client);

    expect(client.post).toHaveBeenCalledWith(
      "https://coordinator",
      "/api/chat/",
      {
        order_id: 123,
        PGP_message: "-----BEGIN PGP MESSAGE-----\\body",
        offset: 4
      },
      auth,
      { timeoutProfile: "action", priority: "action", source: "chat" }
    );
  });

  it("preserves current plaintext payment-reference chat payloads", () => {
    expect(escapeChatPayload("# reference\nkeeps newlines")).toBe("# reference\nkeeps newlines");
  });

  it("posts plaintext payment-reference messages without escaping", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ messages: [] }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await postChatMessage("https://coordinator", 123, "# payment reference\nline 2", 4, auth, client);

    expect(client.post).toHaveBeenCalledWith(
      "https://coordinator",
      "/api/chat/",
      {
        order_id: 123,
        PGP_message: "# payment reference\nline 2",
        offset: 4
      },
      auth,
      { timeoutProfile: "action", priority: "action", source: "chat" }
    );
  });
});
