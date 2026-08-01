import { useEffect, useId, useMemo, useRef, useState } from "react";
import { sha256 } from "js-sha256";
import { ChevronDown, Download, MessageSquare, Send } from "lucide-react";
import { escapeChatPayload, fetchChatMessages, normalizeChatMessage, postChatMessage } from "@/domains/chat/chatApi";
import { decryptChatMessage, encryptChatMessage } from "@/domains/chat/chatCrypto";
import { messageContainsRobotToken } from "@/domains/chat/chatSafety";
import type { ChatMessage, ChatResponse, DisplayChatMessage } from "@/domains/chat/chat.types";
import type { RobotRecord } from "@/domains/garage/garageStore";
import type { ApiRequestOptions, Auth } from "@/domains/transport/apiClient";
import { Button } from "@/components/ui/button";
import { toUserMessage } from "@/lib/userError";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { createWebSocket, isNativeApp } from "@/domains/transport/androidBridge";
import { deliverChatFeedback } from "@/domains/notifications/tradeFeedback";
import { chatPollDelayMs, chatReconnectDelayMs } from "@/domains/chat/chatRefresh";
import {
  orderChangeMatches,
  subscribeOrderChangeNotifications
} from "@/domains/orders/orderChangeNotifications";
import { subscribeRefreshIntents } from "@/domains/transport/refreshIntents";
import { hasSentPreChatMessage, isOwnChatMessage, usablePeerPublicKey, visiblePreChatMessages } from "@/domains/chat/preChat";

export function ChatStagePanel({
  auth,
  baseUrl,
  canSend,
  myNick,
  ownCoordinatorNick,
  myHashId,
  orderId,
  peerNick,
  peerHashId,
  previewMode = false,
  robot,
  shortAlias,
  slotToken,
  variant = "trade"
}: {
  auth?: Auth;
  baseUrl?: string;
  canSend: boolean;
  myNick: string;
  ownCoordinatorNick?: string;
  myHashId?: string;
  orderId: number;
  peerNick: string;
  peerHashId?: string;
  previewMode?: boolean;
  robot?: RobotRecord;
  shortAlias?: string;
  slotToken?: string;
  variant?: "trade" | "pre-chat";
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<DisplayChatMessage[]>(() => previewMode ? previewChatMessages(myNick, peerNick) : []);
  const [peerConnected, setPeerConnected] = useState(previewMode);
  const [peerPubkey, setPeerPubkey] = useState("");
  const [sending, setSending] = useState(false);
  const [socketConnected, setSocketConnected] = useState(previewMode);
  const [historyStatus, setHistoryStatus] = useState<"idle" | "loading" | "ready" | "error">(
    previewMode ? "ready" : "idle"
  );
  const [messageAnnouncement, setMessageAnnouncement] = useState("");
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const knownMessageIndexesRef = useRef(new Set(messages.map((message) => message.index)));
  const historyReadyRef = useRef(previewMode);
  const loadErrorRef = useRef("");
  const peerPubkeyRef = useRef("");
  const decryptFailureAttemptsRef = useRef(new Map<string, number>());
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const errorId = useId();

  const isPreChat = variant === "pre-chat";
  const canonicalMyNick = ownCoordinatorNick?.trim() || myNick;
  const canLoad = previewMode || Boolean(baseUrl && auth && robot?.encPrivKey && robot.pubKey && slotToken && orderId);
  const lastIndex = useMemo(() => messages.reduce((max, message) => Math.max(max, message.index), 0), [messages]);
  const preChatMessageSent = isPreChat && hasSentPreChatMessage(messages);

  useEffect(() => {
    peerPubkeyRef.current = peerPubkey;
  }, [peerPubkey]);

  useEffect(() => {
    if (previewMode) return;
    const reconnect = () => setConnectionEpoch((value) => value + 1);
    const stopLifecycle = subscribeRefreshIntents(reconnect);
    const stopOrderChanges = subscribeOrderChangeNotifications((notification) => {
      if (!orderChangeMatches(notification, { shortAlias, orderId })) return false;
      reconnect();
      return true;
    }, { consumerId: `chat:${shortAlias}:${orderId}` });
    return () => {
      stopLifecycle();
      stopOrderChanges();
    };
  }, [orderId, previewMode, shortAlias]);

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  async function loadMessages(
    offset = lastIndex,
    reportError = true,
    options: ApiRequestOptions = {}
  ): Promise<ChatResponse | undefined> {
    if (!baseUrl || !auth || !canLoad) return undefined;
    const loadingHistory = offset === 0 && !historyReadyRef.current;
    if (loadingHistory) setHistoryStatus("loading");
    if (reportError) {
      loadErrorRef.current = "";
      setError("");
    }
    try {
      const response = await fetchChatMessages(baseUrl, orderId, offset, auth, undefined, options);
      await applyChatResponse(response, historyReadyRef.current);
      historyReadyRef.current = true;
      if (loadingHistory) setHistoryStatus("ready");
      const recoveredError = loadErrorRef.current;
      if (recoveredError) {
        loadErrorRef.current = "";
        setError((current) => current === recoveredError ? "" : current);
      }
      return response;
    } catch (loadError) {
      if (loadingHistory) setHistoryStatus("error");
      if (reportError) {
        const message = toUserMessage(loadError, "Could not load chat.");
        loadErrorRef.current = message;
        setError(message);
      }
      return undefined;
    }
  }

  async function sendMessage() {
    setError("");
    const text = draft.trim();
    if (!text) return;
    if (preChatMessageSent) {
      setError("This robot has already left its early message for this trade.");
      return;
    }
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
    const sendsPlaintextCommand = variant === "trade" && text.startsWith("#");
    const currentPeerPubkey = peerPubkeyRef.current;
    if (!sendsPlaintextCommand && !currentPeerPubkey) {
      setError("Preparing your peer's encryption key. The message can be sent as soon as it is ready.");
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
            peerPublicKeyArmored: currentPeerPubkey
          });
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "message", message: escapeChatPayload(outgoingMessage), nick: canonicalMyNick }));
      } else {
        const response = await postChatMessage(baseUrl, orderId, outgoingMessage, lastIndex, auth);
        await applyChatResponse(response);
      }
      setDraft("");
    } catch (sendError) {
      if (isPreChat) {
        const recovered = await loadMessages(0, false, {
          timeoutProfile: "interactive",
          priority: "foreground"
        });
        if (recovered?.messages.length) {
          setDraft("");
          setError("");
          return;
        }
      }
      setError(toUserMessage(sendError, "Could not send chat message."));
    } finally {
      setSending(false);
    }
  }

  async function applyChatResponse(response: ChatResponse, notifyNewMessages = historyReadyRef.current) {
    setPeerConnected(response.peerConnected);
    const responsePeerPubkey = usablePeerPublicKey(response.peerPubkey, robot?.pubKey ?? "");
    if (responsePeerPubkey) {
      peerPubkeyRef.current = responsePeerPubkey;
      setPeerPubkey(responsePeerPubkey);
    }
    if (!robot?.encPrivKey || !robot.pubKey || !slotToken) return;

    const decryptedMessages = await Promise.all(
      response.messages.map((message) =>
        decryptDisplayMessage(message, {
          ownCoordinatorNick: canonicalMyNick,
          ownPrivateKeyArmored: robot.encPrivKey ?? "",
          ownPublicKeyArmored: robot.pubKey ?? "",
          passphrase: slotToken,
          peerPublicKeyArmored: responsePeerPubkey || peerPubkeyRef.current,
          senderOnlyResponse: isPreChat
        })
      )
    );
    const nextMessages = decryptedMessages.filter((message) => {
      const failureKey = `${message.index}:${message.encryptedMessage}`;
      if (!message.decryptFailed) {
        decryptFailureAttemptsRef.current.delete(failureKey);
        return true;
      }
      const attempts = (decryptFailureAttemptsRef.current.get(failureKey) ?? 0) + 1;
      decryptFailureAttemptsRef.current.set(failureKey, attempts);
      return attempts > 1;
    });

    const visibleMessages = isPreChat ? visiblePreChatMessages(nextMessages) : nextMessages;
    const newPeerMessages = visibleMessages.filter(
      (message) => !knownMessageIndexesRef.current.has(message.index) && !message.mine && !message.decryptFailed
    );
    visibleMessages.forEach((message) => knownMessageIndexesRef.current.add(message.index));
    setMessages((current) => mergeMessages(current, visibleMessages));
    if (notifyNewMessages && newPeerMessages.length > 0) {
      const latest = newPeerMessages.at(-1);
      setMessageAnnouncement(`New message from ${latest?.nick || peerNick}: ${latest?.plaintext || ""}`);
    }
    if (!isPreChat && notifyNewMessages && shortAlias && newPeerMessages.length > 0) {
      deliverChatFeedback({
        lastIndex: Math.max(...newPeerMessages.map((message) => message.index)),
        orderId,
        peerName: newPeerMessages.at(-1)?.nick || peerNick,
        shortAlias
      });
    }
  }

  useEffect(() => {
    if (!canLoad || previewMode || isPreChat) return;
    void loadMessages(0, true, { timeoutProfile: "interactive", priority: "foreground" });
  }, [canLoad, connectionEpoch, isPreChat, orderId, previewMode]);

  useEffect(() => {
    if (!canLoad || previewMode || !isPreChat) return;
    let disposed = false;
    let retryTimer: number | undefined;

    const reconcilePreChat = async (attempt: number) => {
      const response = await loadMessages(
        0,
        attempt === 0,
        attempt === 0
          ? { timeoutProfile: "interactive", priority: "foreground" }
          : { timeoutProfile: "background", priority: "visible" }
      );
      if (disposed || response?.peerPubkey) return;
      const delay = Math.min(12_000, 1_500 * 2 ** Math.min(attempt, 3));
      retryTimer = window.setTimeout(() => void reconcilePreChat(attempt + 1), delay);
    };

    void reconcilePreChat(0);
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [canLoad, connectionEpoch, isPreChat, orderId, previewMode]);

  useEffect(() => {
    if (isPreChat || !canLoad || previewMode) return;
    let disposed = false;
    let timer: number | undefined;
    const schedule = () => {
      if (disposed) return;
      if (document.hidden && isNativeApp()) return;
      timer = window.setTimeout(async () => {
        await loadMessages(lastIndex, false);
        schedule();
      }, chatPollDelayMs(socketConnected, document.hidden));
    };
    schedule();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [canLoad, isPreChat, lastIndex, orderId, previewMode, socketConnected]);

  useEffect(() => {
    if (variant === "pre-chat" || !canLoad || previewMode || !baseUrl || !robot?.pubKey || !slotToken) return;

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
        socket.send(JSON.stringify({ type: "message", message: robot.pubKey, nick: canonicalMyNick }));
        void loadMessages(lastIndex, false);
      };
      socket.onmessage = (event) => {
        attempts = 0;
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
          const socketPeerPubkey = usablePeerPublicKey(message.encryptedMessage, robot.pubKey ?? "");
          if (socketPeerPubkey) {
            peerPubkeyRef.current = socketPeerPubkey;
            setPeerPubkey(socketPeerPubkey);
            socketRef.current?.send(JSON.stringify({ type: "message", message: "-----SERVE HISTORY-----", nick: canonicalMyNick }));
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
  }, [baseUrl, canLoad, canonicalMyNick, connectionEpoch, orderId, previewMode, robot?.pubKey, slotToken, variant]);

  return (
    <Card className="chat-panel">
      <CardHeader className="chat-header">
        <div className="chat-header-row">
          <CardTitle>{isPreChat ? "Early message" : "Trade chat"}</CardTitle>
          {!isPreChat && canLoad && messages.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => exportChatLogs()} title="Export encrypted chat logs">
              <Download size={15} /> Chat logs
            </Button>
          ) : null}
        </div>
        <div className="chat-participants" aria-label="Trade participants">
          <div
            aria-label={`Your robot: ${myNick || "Your robot"}`}
            className="chat-participant chat-participant-you"
            tabIndex={0}
          >
            <RobotAvatar hashId={myHashId} label={myNick || "Your robot"} size="sm" />
            <span>
              <strong title={myNick || "Your robot"}>{myNick || "Your robot"}</strong>
              <small>You</small>
            </span>
          </div>
          <span className="chat-participant-divider" aria-hidden>trading with</span>
          <div
            aria-label={`Trade peer: ${peerNick || "Trade peer"}`}
            className="chat-participant chat-participant-peer"
            tabIndex={0}
          >
            <RobotAvatar hashId={peerHashId} label={peerNick || "Trade peer"} size="sm" />
            <span>
              <strong title={peerNick || "Trade peer"}>{peerNick || "Trade peer"}</strong>
              <small>Peer</small>
              {!isPreChat ? (
                <span className={peerConnected ? "chat-presence chat-presence-online" : "chat-presence"}>
                  {peerConnected ? "Online" : socketConnected ? "Away" : "Offline"}
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!canLoad ? (
          <p className="muted-copy">Load this live order with your robot keys to decrypt chat.</p>
        ) : (
          <div className="chat-stack">
            <span aria-live="polite" className="sr-only" role="status">{messageAnnouncement}</span>
            <div aria-label="Trade chat history" className="chat-messages" ref={messagesRef} role="log">
              {messages.length === 0 && historyStatus === "loading" ? (
                <div className="chat-loading" role="status">
                  <span className="ui-spinner" aria-hidden="true" />
                  <span>{isPreChat ? "Loading early message..." : "Loading chat..."}</span>
                </div>
              ) : null}
              {messages.length === 0 && historyStatus === "ready" ? (
                <p className="chat-empty">
                  {isPreChat ? "No early message sent." : "No chat messages yet."}
                </p>
              ) : null}
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
                aria-describedby={error ? errorId : undefined}
                aria-invalid={Boolean(error)}
                aria-label={isPreChat ? "Early message to your peer" : "Message to your trade peer"}
                disabled={!canSend || sending || preChatMessageSent}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  preChatMessageSent
                    ? "Early message saved"
                    : canSend
                      ? isPreChat
                        ? "Leave one encrypted message for your peer..."
                      : "Type a message to your peer..."
                    : "Chat is read-only while the coordinator reviews."
                }
                rows={3}
                value={draft}
              />
              <Button
                aria-label={sending ? "Sending message" : "Send message"}
                className="chat-send-button"
                disabled={!canSend || !draft.trim() || preChatMessageSent || (isPreChat && !peerPubkey)}
                loading={sending}
                size="icon"
                title={
                  isPreChat && !peerPubkey
                    ? "Preparing encrypted message"
                    : draft.trim()
                      ? "Send message"
                      : "Type a message first"
                }
                type="submit"
                variant="outline"
              >
                {sending ? null : <Send aria-hidden size={18} />}
                <span className="sr-only">{sending ? "Sending message" : "Send message"}</span>
              </Button>
            </form>

            {preChatMessageSent ? (
              <p className="pre-chat-saved" role="status">
                Message saved. Your peer will see it when trade chat opens.
              </p>
            ) : isPreChat && !peerPubkey ? (
              <p className="pre-chat-key-status" role="status">
                <span className="ui-spinner" aria-hidden="true" />
                Preparing encrypted messaging...
              </p>
            ) : null}
            {error ? <p className="field-error" id={errorId} role="alert">{error}</p> : null}
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

export function PreChatDisclosure(props: Omit<Parameters<typeof ChatStagePanel>[0], "variant">) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="pre-chat-disclosure"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="pre-chat-summary">
        <span className="pre-chat-summary-icon" aria-hidden="true">
          <MessageSquare size={18} />
        </span>
        <span className="pre-chat-summary-copy">
          <strong>Leave a message for your peer</strong>
          <small>One optional encrypted message. Your peer sees it when trade chat opens.</small>
        </span>
        <ChevronDown className="pre-chat-summary-chevron" size={18} aria-hidden="true" />
      </summary>
      <ChatStagePanel
        key={`${props.orderId}:${props.peerHashId || props.peerNick}`}
        {...props}
        variant="pre-chat"
      />
    </details>
  );
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
  if (message.decryptFailed) {
    return (
      <div className="chat-message-unavailable" role="status">
        <span>An encrypted message could not be opened on this device.</span>
      </div>
    );
  }
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
      </div>
    </article>
  );
}

async function decryptDisplayMessage(
  message: ChatMessage,
  keys: {
    ownCoordinatorNick: string;
    ownPrivateKeyArmored: string;
    ownPublicKeyArmored: string;
    passphrase: string;
    peerPublicKeyArmored?: string;
    senderOnlyResponse?: boolean;
  }
): Promise<DisplayChatMessage> {
  const mine = isOwnChatMessage(
    message.nick,
    keys.ownCoordinatorNick,
    keys.senderOnlyResponse
  );
  if (message.encryptedMessage.startsWith("#")) {
    return {
      ...message,
      decryptFailed: false,
      mine,
      plaintext: message.encryptedMessage
    };
  }

  try {
    const plaintext = await decryptChatMessage({
      armoredMessage: message.encryptedMessage,
      ownPrivateKeyArmored: keys.ownPrivateKeyArmored,
      ownPublicKeyArmored: keys.ownPublicKeyArmored,
      passphrase: keys.passphrase,
      peerPublicKeyArmored: mine ? undefined : keys.peerPublicKeyArmored
    });
    return {
      ...message,
      decryptFailed: false,
      mine,
      plaintext
    };
  } catch {
    return {
      ...message,
      decryptFailed: true,
      mine,
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
