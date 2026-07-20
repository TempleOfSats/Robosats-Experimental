import { useEffect, useMemo, useRef, useState } from "react";
import { sha256 } from "js-sha256";
import { Download, Send } from "lucide-react";
import { escapeChatPayload, fetchChatMessages, normalizeChatMessage, postChatMessage } from "@/domains/chat/chatApi";
import { decryptChatMessage, encryptChatMessage } from "@/domains/chat/chatCrypto";
import { messageContainsRobotToken } from "@/domains/chat/chatSafety";
import type { ChatMessage, ChatResponse, DisplayChatMessage } from "@/domains/chat/chat.types";
import type { RobotRecord } from "@/domains/garage/garageStore";
import type { Auth } from "@/domains/transport/apiClient";
import { Button } from "@/components/ui/button";
import { toUserMessage } from "@/lib/userError";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { createWebSocket } from "@/domains/transport/androidBridge";
import { playTradeAudio } from "@/domains/audio/audioController";
import { chatPollDelayMs, chatReconnectDelayMs } from "@/domains/chat/chatRefresh";

export function ChatStagePanel({
  auth,
  baseUrl,
  canSend,
  myNick,
  myHashId,
  orderId,
  peerNick,
  peerHashId,
  previewMode = false,
  robot,
  slotToken
}: {
  auth?: Auth;
  baseUrl?: string;
  canSend: boolean;
  myNick: string;
  myHashId?: string;
  orderId: number;
  peerNick: string;
  peerHashId?: string;
  previewMode?: boolean;
  robot?: RobotRecord;
  slotToken?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<DisplayChatMessage[]>(() => previewMode ? previewChatMessages(myNick, peerNick) : []);
  const [peerConnected, setPeerConnected] = useState(previewMode);
  const [peerPubkey, setPeerPubkey] = useState("");
  const [sending, setSending] = useState(false);
  const [socketConnected, setSocketConnected] = useState(previewMode);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const audibleMessageCountRef = useRef(messages.length);
  const peerPubkeyRef = useRef("");
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const canLoad = previewMode || Boolean(baseUrl && auth && robot?.encPrivKey && robot.pubKey && slotToken && orderId);
  const lastIndex = useMemo(() => messages.reduce((max, message) => Math.max(max, message.index), 0), [messages]);

  useEffect(() => {
    peerPubkeyRef.current = peerPubkey;
  }, [peerPubkey]);

  useEffect(() => {
    if (previewMode) return;
    const reconnect = () => setConnectionEpoch((value) => value + 1);
    const reconnectWhenVisible = () => {
      if (document.visibilityState === "visible") reconnect();
    };
    window.addEventListener("robosats:tor-reconnected", reconnect);
    window.addEventListener("robosats:native-resume", reconnect);
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnectWhenVisible);
    return () => {
      window.removeEventListener("robosats:tor-reconnected", reconnect);
      window.removeEventListener("robosats:native-resume", reconnect);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnectWhenVisible);
    };
  }, [previewMode]);

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const previousCount = audibleMessageCountRef.current;
    audibleMessageCountRef.current = messages.length;
    if (previewMode || messages.length <= previousCount) return;
    void playTradeAudio("chat-open").catch(() => undefined);
  }, [messages.length, previewMode]);

  async function loadMessages(offset = lastIndex, reportError = true) {
    if (!baseUrl || !auth || !canLoad) return;
    if (reportError) setError("");
    try {
      const response = await fetchChatMessages(baseUrl, orderId, offset, auth);
      await applyChatResponse(response);
    } catch (loadError) {
      if (reportError) setError(toUserMessage(loadError, "Could not load chat."));
    }
  }

  async function sendMessage() {
    setError("");
    const text = draft.trim();
    if (!text) return;
    if (previewMode) {
      setMessages((current) => [...current, {
        index: current.reduce((max, message) => Math.max(max, message.index), 0) + 1,
        time: new Date().toISOString(),
        encryptedMessage: "[fixture message]",
        nick: myNick || "Your robot",
        plaintext: text,
        mine: true,
        decryptFailed: false
      }]);
      setDraft("");
      return;
    }
    if (!baseUrl || !auth || !robot?.encPrivKey || !robot.pubKey || !slotToken) {
      setError("Load this live order with your robot before sending chat messages.");
      return;
    }
    if (messageContainsRobotToken(text, slotToken)) {
      setError("Message blocked: never share your robot token with anyone, including your trade peer.");
      return;
    }
    const sendsPlaintextCommand = text.startsWith("#");
    if (!sendsPlaintextCommand && !peerPubkey) {
      setError("Peer public key is not available yet. Refresh chat first.");
      return;
    }

    setSending(true);
    try {
      const outgoingMessage = sendsPlaintextCommand
        ? text
        : await encryptChatMessage({
            message: text,
            ownPrivateKeyArmored: robot.encPrivKey,
            ownPublicKeyArmored: robot.pubKey,
            passphrase: slotToken,
            peerPublicKeyArmored: peerPubkey
          });
      const socket = socketRef.current;
      setDraft("");
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "message", message: escapeChatPayload(outgoingMessage), nick: myNick }));
      } else {
        const response = await postChatMessage(baseUrl, orderId, outgoingMessage, lastIndex, auth);
        await applyChatResponse(response);
      }
    } catch (sendError) {
      setError(toUserMessage(sendError, "Could not send chat message."));
    } finally {
      setSending(false);
    }
  }

  async function applyChatResponse(response: ChatResponse) {
    setPeerConnected(response.peerConnected);
    if (response.peerPubkey) {
      peerPubkeyRef.current = response.peerPubkey;
      setPeerPubkey(response.peerPubkey);
    }
    if (!robot?.encPrivKey || !robot.pubKey || !slotToken) return;

    const nextMessages = await Promise.all(
      response.messages.map((message) =>
        decryptDisplayMessage(message, {
          myNick,
          ownPrivateKeyArmored: robot.encPrivKey ?? "",
          ownPublicKeyArmored: robot.pubKey ?? "",
          passphrase: slotToken,
          peerPublicKeyArmored: response.peerPubkey || peerPubkeyRef.current
        })
      )
    );

    setMessages((current) => mergeMessages(current, nextMessages));
  }

  useEffect(() => {
    if (!canLoad || previewMode) return;
    void loadMessages(0);
  }, [canLoad, connectionEpoch, orderId, previewMode]);

  useEffect(() => {
    if (!canLoad || previewMode) return;
    const interval = window.setInterval(
      () => void loadMessages(lastIndex, false),
      chatPollDelayMs(socketConnected)
    );
    return () => window.clearInterval(interval);
  }, [canLoad, lastIndex, orderId, previewMode, socketConnected]);

  useEffect(() => {
    if (!canLoad || previewMode || !baseUrl || !robot?.pubKey || !slotToken) return;

    let disposed = false;
    let reconnectTimer: number | undefined;
    let attempts = 0;

    const connect = () => {
      if (disposed) return;
      const socket = createWebSocket(buildChatSocketUrl(baseUrl, orderId, slotToken));
      socketRef.current = socket;

      socket.onopen = () => {
        attempts = 0;
        setSocketConnected(true);
        socket.send(JSON.stringify({ type: "message", message: robot.pubKey, nick: myNick }));
      };
      socket.onmessage = (event) => {
        void applySocketMessage(String(event.data));
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = undefined;
        setSocketConnected(false);
        if (disposed) return;
        attempts += 1;
        reconnectTimer = window.setTimeout(connect, chatReconnectDelayMs(attempts));
      };
    };

    const applySocketMessage = async (raw: string) => {
      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        const peerIsConnected = data.peer_connected === true || data.peer_connected === 1 || data.peer_connected === "true";
        setPeerConnected(peerIsConnected);
        const message = normalizeChatMessage(data);
        if (!message.encryptedMessage) return;

        if (message.encryptedMessage.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
          if (message.encryptedMessage !== robot.pubKey) {
            peerPubkeyRef.current = message.encryptedMessage;
            setPeerPubkey(message.encryptedMessage);
            socketRef.current?.send(JSON.stringify({ type: "message", message: "-----SERVE HISTORY-----", nick: myNick }));
          }
          return;
        }

        await applyChatResponse({
          peerConnected: peerIsConnected,
          peerPubkey: peerPubkeyRef.current,
          messages: [message]
        });
      } catch {
        // Ignore malformed socket frames. REST polling remains available as fallback.
      }
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = undefined;
    };
  }, [baseUrl, canLoad, connectionEpoch, myNick, orderId, previewMode, robot?.pubKey, slotToken]);

  return (
    <Card className="chat-panel">
      <CardHeader className="chat-header">
        <div className="chat-header-row">
          <CardTitle>Trade chat</CardTitle>
          {canLoad && messages.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => exportChatLogs()} title="Export encrypted chat logs">
              <Download size={15} /> Chat logs
            </Button>
          ) : null}
        </div>
        <div className="chat-participants" aria-label="Trade participants">
          <div className="chat-participant chat-participant-you">
            <RobotAvatar hashId={myHashId} label={myNick || "Your robot"} size="sm" />
            <span><strong>{myNick || "Your robot"}</strong></span>
          </div>
          <span className="chat-participant-divider" aria-hidden>trading with</span>
          <div className="chat-participant chat-participant-peer">
            <RobotAvatar hashId={peerHashId} label={peerNick || "Trade peer"} size="sm" />
            <span>
              <strong>{peerNick || "Trade peer"}</strong>
              <span className={peerConnected ? "chat-presence chat-presence-online" : "chat-presence"}>
                {peerConnected ? "Online" : socketConnected ? "Away" : "Offline"}
              </span>
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!canLoad ? (
          <p className="muted-copy">Load this live order with your robot keys to decrypt chat.</p>
        ) : (
          <div className="chat-stack">
            <div className="chat-messages" ref={messagesRef} role="log" aria-live="polite">
              {messages.length === 0 ? <p className="chat-empty">No chat messages yet.</p> : null}
              {messages.map((message) => (
                <MessageBubble
                  key={message.index}
                  message={message}
                  myHashId={myHashId}
                  myNick={myNick}
                  peerHashId={peerHashId}
                  peerNick={peerNick}
                />
              ))}
            </div>

            <form
              className="chat-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <textarea
                disabled={!canSend || sending}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={canSend ? "Type a message to your peer..." : "Chat is read-only while the coordinator reviews."}
                rows={3}
                value={draft}
              />
              <Button
                aria-label={sending ? "Sending message" : "Send message"}
                className="chat-send-button"
                disabled={!canSend || !draft.trim()}
                loading={sending}
                size="icon"
                title={draft.trim() ? "Send message" : "Type a message first"}
                type="submit"
              >
                {sending ? null : <Send aria-hidden size={18} />}
                <span className="sr-only">{sending ? "Sending message" : "Send message"}</span>
              </Button>
            </form>

            {error ? <p className="field-error">{error}</p> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );

  function exportChatLogs() {
    if (previewMode) {
      downloadChatLogs(orderId, {
        version: 1,
        fixture: true,
        order_id: orderId,
        exported_at: new Date().toISOString(),
        messages: messages.map(({ index, time, plaintext, nick }) => ({ index, time, message: plaintext, nick }))
      });
      return;
    }
    if (!robot?.encPrivKey || !robot.pubKey || !slotToken) return;
    if (!window.confirm("This chat log file contains the private chat key and robot passphrase. Store it securely and share it only with the dispute coordinator.")) return;
    const chatLogs = {
      version: 1,
      order_id: orderId,
      exported_at: new Date().toISOString(),
      credentials: {
        own_public_key: robot.pubKey,
        peer_public_key: peerPubkey,
        encrypted_private_key: robot.encPrivKey,
        passphrase: slotToken
      },
      messages: messages.map(({ index, time, encryptedMessage, nick }) => ({ index, time, message: encryptedMessage, nick }))
    };
    downloadChatLogs(orderId, chatLogs);
  }
}

function previewChatMessages(myNick: string, peerNick: string): DisplayChatMessage[] {
  const now = Date.now();
  return [
    { index: 1, time: new Date(now - 120_000).toISOString(), encryptedMessage: "[fixture message]", nick: peerNick || "Trade peer", plaintext: "Hi. I am ready to complete the payment.", mine: false, decryptFailed: false },
    { index: 2, time: new Date(now - 60_000).toISOString(), encryptedMessage: "[fixture message]", nick: myNick || "Your robot", plaintext: "Ready here too. I will confirm as soon as it is sent.", mine: true, decryptFailed: false }
  ];
}

function downloadChatLogs(orderId: number, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `robosats-order-${orderId}-chat-logs.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildChatSocketUrl(baseUrl: string, orderId: number, token: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/chat/${orderId}/`;
  url.search = `token_sha256_hex=${sha256(token)}`;
  return url.toString();
}

function MessageBubble({
  message,
  myHashId,
  myNick,
  peerHashId,
  peerNick
}: {
  message: DisplayChatMessage;
  myHashId?: string;
  myNick: string;
  peerHashId?: string;
  peerNick: string;
}) {
  const nick = message.nick || (message.mine ? myNick || "Your robot" : peerNick || "Trade peer");
  return (
    <article className={message.mine ? "chat-message chat-message-mine" : "chat-message"}>
      <RobotAvatar hashId={message.mine ? myHashId : peerHashId} label={nick} size="sm" />
      <div className={message.mine ? "chat-bubble chat-bubble-mine" : "chat-bubble"}>
        <div className="chat-bubble-meta">
          <span className="chat-bubble-author">
            <strong>{nick}</strong>
          </span>
          <time>{formatChatTime(message.time)}</time>
        </div>
        <p>{message.plaintext}</p>
        {message.decryptFailed ? <small>Could not decrypt this message.</small> : null}
      </div>
    </article>
  );
}

async function decryptDisplayMessage(
  message: ChatMessage,
  keys: {
    myNick: string;
    ownPrivateKeyArmored: string;
    ownPublicKeyArmored: string;
    passphrase: string;
    peerPublicKeyArmored?: string;
  }
): Promise<DisplayChatMessage> {
  if (message.encryptedMessage.startsWith("#")) {
    return {
      ...message,
      decryptFailed: false,
      mine: message.nick === keys.myNick,
      plaintext: message.encryptedMessage
    };
  }

  try {
    const plaintext = await decryptChatMessage({
      armoredMessage: message.encryptedMessage,
      ownPrivateKeyArmored: keys.ownPrivateKeyArmored,
      ownPublicKeyArmored: keys.ownPublicKeyArmored,
      passphrase: keys.passphrase,
      peerPublicKeyArmored: keys.peerPublicKeyArmored
    });
    return {
      ...message,
      decryptFailed: false,
      mine: message.nick === keys.myNick,
      plaintext
    };
  } catch {
    return {
      ...message,
      decryptFailed: true,
      mine: message.nick === keys.myNick,
      plaintext: "Encrypted message could not be decrypted."
    };
  }
}

function mergeMessages(current: DisplayChatMessage[], incoming: DisplayChatMessage[]): DisplayChatMessage[] {
  const byIndex = new Map(current.map((message) => [message.index, message]));
  for (const message of incoming) byIndex.set(message.index, message);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

function formatChatTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
