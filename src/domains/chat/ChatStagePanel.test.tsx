// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatStagePanel, mergeMessages } from "@/domains/chat/ChatStagePanel";
import type { DisplayChatMessage } from "@/domains/chat/chat.types";

const mocks = vi.hoisted(() => ({
  fetchChatMessages: vi.fn(),
  socket: undefined as FakeSocket | undefined
}));

vi.mock("@/domains/chat/chatApi", async () => ({
  ...(await vi.importActual<typeof import("@/domains/chat/chatApi")>("@/domains/chat/chatApi")),
  fetchChatMessages: mocks.fetchChatMessages
}));

vi.mock("@/domains/transport/androidBridge", () => ({
  createWebSocket: vi.fn(() => {
    const socket = new FakeSocket();
    mocks.socket = socket;
    return socket;
  }),
  isNativeApp: () => false
}));

class FakeSocket {
  static readonly OPEN = 1;
  readyState = FakeSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => this.onclose?.());
}

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  mocks.fetchChatMessages.mockReset();
  mocks.socket = undefined;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ChatStagePanel presence", () => {
  it("keeps explicit presence through missing/stale observations and clears it on close", async () => {
    const pending: Array<(response: { peerConnected?: boolean; peerPubkey: string; messages: never[] }) => void> = [];
    mocks.fetchChatMessages.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    await renderPanel();
    await vi.waitFor(() => expect(mocks.fetchChatMessages).toHaveBeenCalledTimes(1));

    await act(async () => {
      mocks.socket?.onopen?.();
      mocks.socket?.onmessage?.({ data: JSON.stringify({ peer_connected: true }) });
    });
    await vi.waitFor(() => expect(mocks.fetchChatMessages).toHaveBeenCalledTimes(2));
    expect(document.querySelector(".chat-presence")?.textContent).toBe("Online");

    await act(async () => {
      pending[0]?.({ peerConnected: false, peerPubkey: "", messages: [] });
      pending[1]?.({ peerConnected: false, peerPubkey: "", messages: [] });
    });
    expect(document.querySelector(".chat-presence")?.textContent).toBe("Online");

    await act(async () => {
      mocks.socket?.onmessage?.({ data: JSON.stringify({}) });
    });
    expect(document.querySelector(".chat-presence")?.textContent).toBe("Online");

    await act(async () => {
      mocks.socket?.onmessage?.({ data: JSON.stringify({ peer_connected: false }) });
    });
    expect(document.querySelector(".chat-presence")?.textContent).toBe("Offline");

    await act(async () => {
      mocks.socket?.onclose?.();
    });
    expect(document.querySelector(".chat-presence")).toBeNull();
  });
});

describe("chat message reconciliation", () => {
  const message = (overrides: Partial<DisplayChatMessage>): DisplayChatMessage => ({
    index: 1,
    time: "2026-01-01T00:00:00Z",
    encryptedMessage: "ciphertext",
    nick: "Peer",
    plaintext: "text",
    mine: false,
    decryptFailed: false,
    signatureStatus: "unknown",
    ...overrides
  });

  it("keeps successful plaintext over failures and upgrades signature confidence", () => {
    const success = message({ plaintext: "decrypted", signatureStatus: "unverified" });
    const failure = message({ decryptFailed: true, plaintext: "Encrypted message could not be decrypted." });
    const verified = message({ plaintext: "decrypted", signatureStatus: "verified" });
    expect(mergeMessages([success], [failure])).toEqual([success]);
    expect(mergeMessages([failure], [success])).toEqual([success]);
    expect(mergeMessages([success], [verified])).toEqual([verified]);
    expect(mergeMessages([verified], [message({ plaintext: "replayed", signatureStatus: "verified" })])).toEqual([
      verified
    ]);
  });
});

async function renderPanel(): Promise<void> {
  root ??= createRoot(document.querySelector("#root")!);
  await act(async () => {
    root?.render(
      <ChatStagePanel
        auth={{ tokenSHA256: "token" }}
        baseUrl="https://coordinator.example"
        canSend={true}
        myNick="Mine"
        myHashId="mine"
        orderId={123}
        peerNick="Peer"
        peerHashId="peer"
        robot={{ encPrivKey: "private", pubKey: "public" } as never}
        slotToken="slot-token"
      />
    );
  });
}
