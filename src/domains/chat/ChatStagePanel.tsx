import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sha256 } from "js-sha256";
import { ChevronDown, Download, MessageSquare, Send } from "lucide-react";
import {
  escapeChatPayload,
  fetchChatMessages,
  isDisplayableChatPayload,
  normalizePeerConnected,
  normalizeChatMessage,
  postChatMessage
} from "@/domains/chat/chatApi";
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
import { orderChangeMatches, subscribeOrderChangeNotifications } from "@/domains/orders/orderChangeNotifications";
import { subscribeRefreshIntents } from "@/domains/transport/refreshIntents";
import {
  hasSentPreChatMessage,
  isOwnChatMessage,
  usablePeerPublicKey,
  visiblePreChatMessages
} from "@/domains/chat/preChat";
import { downloadTextFile } from "@/domains/transport/downloadFile";

type ChatHistoryStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

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
  const [messages, setMessages] = useState<DisplayChatMessage[]>(() =>
    previewMode ? previewChatMessages(myNick, peerNick) : []
  );
  const [peerConnected, setPeerConnected] = useState<boolean | undefined>(previewMode ? true : undefined);
  const [peerPubkey, setPeerPubkey] = useState("");
  const [sending, setSending] = useState(false);
  const [socketConnected, setSocketConnected] = useState(previewMode);
  const [historyStatus, setHistoryStatus] = useState<ChatHistoryStatus>(previewMode ? "ready" : "idle");
  const [messageAnnouncement, setMessageAnnouncement] = useState("");
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [visibleCount, setVisibleCount] = useState(VISIBLE_MESSAGE_WINDOW);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const knownMessageIndexesRef = useRef(new Set(messages.map((message) => message.index)));
  const historyReadyRef = useRef(previewMode);
  const loadErrorRef = useRef("");
  const peerPubkeyRef = useRef("");
  const presenceRevisionRef = useRef(0);
  const latestPresenceRequestRef = useRef(0);
  const initialHistoryLoadRef = useRef<Promise<ChatResponse | undefined> | undefined>(undefined);
  const historyExpansionAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | undefined>(undefined);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const stickToLatestRef = useRef(true);
  const renderedMessageCountRef = useRef(messages.length);
  const renderedMaxMessageIndexRef = useRef(maxMessageIndex(messages));
  const errorId = useId();

  const isPreChat = variant === "pre-chat";
  const canonicalMyNick = ownCoordinatorNick?.trim() || myNick;
  const stableAuth = useMemo<Auth | undefined>(
    () => copyAuth(auth),
    [auth?.keys?.encPrivKey, auth?.keys?.pubKey, auth?.nostrPubkey, auth?.tokenSHA256]
  );
  const robotPrivateKey = robot?.encPrivKey;
  const robotPublicKey = robot?.pubKey;
  const canLoad =
    previewMode || hasLiveChatCredentials(baseUrl, stableAuth, robotPrivateKey, robotPublicKey, slotToken, orderId);
  const lastIndex = useMemo(() => messages.reduce((max, message) => Math.max(max, message.index), 0), [messages]);
  const lastIndexRef = useRef(lastIndex);
  lastIndexRef.current = lastIndex;
  const visibleMessages = useMemo(
    () => messages.slice(-Math.min(visibleCount, messages.length)),
    [messages, visibleCount]
  );
  const preChatMessageSent = isPreChat && hasSentPreChatMessage(messages);
  const hasLivePresence = peerConnected === true || peerConnected === false;

  useEffect(() => {
    peerPubkeyRef.current = peerPubkey;
  }, [peerPubkey]);

  useEffect(() => {
    if (previewMode) return;
    const reconnect = () => setConnectionEpoch((value) => value + 1);
    const stopLifecycle = subscribeRefreshIntents(reconnect);
    const stopOrderChanges = subscribeOrderChangeNotifications(
      (notification) => {
        if (!orderChangeMatches(notification, { shortAlias, orderId })) return false;
        reconnect();
        return true;
      },
      { consumerId: `chat:${shortAlias}:${orderId}` }
    );
    return () => {
      stopLifecycle();
      stopOrderChanges();
    };
  }, [orderId, previewMode, shortAlias]);

  useEffect(() => {
    const previousCount = renderedMessageCountRef.current;
    const addedCount = Math.max(0, messages.length - previousCount);
    const previousMaxMessageIndex = renderedMaxMessageIndexRef.current;
    const unreadCount = messages.filter((message) => message.index > previousMaxMessageIndex && !message.mine).length;
    renderedMessageCountRef.current = messages.length;
    renderedMaxMessageIndexRef.current = Math.max(previousMaxMessageIndex, maxMessageIndex(messages));
    updateUnreadMessageState({
      addedCount,
      element: messagesRef.current,
      messagesRef,
      previousCount,
      setNewMessageCount,
      stickToLatest: stickToLatestRef.current,
      unreadCount
    });
  }, [messages.length]);

  useEffect(() => {
    setVisibleCount(VISIBLE_MESSAGE_WINDOW);
    setNewMessageCount(0);
    stickToLatestRef.current = true;
    renderedMessageCountRef.current = 0;
    renderedMaxMessageIndexRef.current = Number.NEGATIVE_INFINITY;
  }, [orderId]);

  useLayoutEffect(() => {
    const anchor = historyExpansionAnchorRef.current;
    const element = messagesRef.current;
    if (!anchor || !element) return;
    element.scrollTop = restoredExpandedScrollTop(anchor.scrollTop, anchor.scrollHeight, element.scrollHeight);
    historyExpansionAnchorRef.current = undefined;
  }, [visibleCount]);

  const handleHistoryScroll = useMemo(
    () => makeScrollHandler(messagesRef, historyExpansionAnchorRef, messages.length, visibleCount, setVisibleCount),
    [messages.length, visibleCount]
  );
  const handleScroll = useCallback(() => {
    const element = messagesRef.current;
    if (element) {
      stickToLatestRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 56;
      if (stickToLatestRef.current) setNewMessageCount(0);
    }
    handleHistoryScroll();
  }, [handleHistoryScroll]);
  const scrollToLatest = useCallback(() => {
    const element = messagesRef.current;
    if (!element) return;
    element.scrollTo({ behavior: "smooth", top: element.scrollHeight });
    stickToLatestRef.current = true;
    setNewMessageCount(0);
  }, []);
  const hasUsablePeerKey = useCallback(() => Boolean(peerPubkeyRef.current), []);

  const loadMessages = useCallback(
    async function loadMessages(
      offset = lastIndexRef.current,
      reportError = true,
      options: ApiRequestOptions = {}
    ): Promise<ChatResponse | undefined> {
      if (!baseUrl || !stableAuth || !canLoad) return undefined;
      if (offset === 0 && initialHistoryLoadRef.current) return initialHistoryLoadRef.current;

      const operation = (async () => {
        const presenceRequest = latestPresenceRequestRef.current + 1;
        latestPresenceRequestRef.current = presenceRequest;
        const presenceRevision = presenceRevisionRef.current;
        const loadingHistory = offset === 0 && !historyReadyRef.current;
        if (loadingHistory) setHistoryStatus("loading");
        if (reportError) {
          loadErrorRef.current = "";
          setError("");
        }
        try {
          const response = await fetchChatMessages(baseUrl, orderId, offset, stableAuth, undefined, options);
          applyPresenceObservation(
            response.peerConnected,
            presenceRequest === latestPresenceRequestRef.current && presenceRevision === presenceRevisionRef.current,
            presenceRevisionRef,
            setPeerConnected
          );
          await applyChatResponse(response, historyReadyRef.current);
          historyReadyRef.current = true;
          if (loadingHistory) setHistoryStatus("ready");
          const recoveredError = loadErrorRef.current;
          if (recoveredError) {
            loadErrorRef.current = "";
            setError((current) => (current === recoveredError ? "" : current));
          }
          return response;
        } catch (loadError) {
          if (loadingHistory) setHistoryStatus("error");
          if (reportError) {
            const message = toUserMessage(
              loadError,
              isPreChat ? "Could not load early messaging." : "Could not load chat."
            );
            loadErrorRef.current = message;
            setError(message);
          }
          return undefined;
        }
      })();

      if (offset !== 0) return operation;
      initialHistoryLoadRef.current = operation;
      try {
        return await operation;
      } finally {
        if (initialHistoryLoadRef.current === operation) initialHistoryLoadRef.current = undefined;
      }
    },
    [
      baseUrl,
      canLoad,
      canonicalMyNick,
      isPreChat,
      myHashId,
      orderId,
      peerNick,
      robotPrivateKey,
      robotPublicKey,
      shortAlias,
      slotToken,
      stableAuth
    ]
  );

  async function sendMessage() {
    setError("");
    const text = draft.trim();
    if (!text) return;
    if (preChatMessageSent) {
      setError("This robot has already left its early message for this trade.");
      return;
    }
    if (previewMode) {
      stickToLatestRef.current = true;
      setNewMessageCount(0);
      setMessages((current) => [
        ...current,
        {
          index: current.reduce((max, message) => Math.max(max, message.index), 0) + 1,
          time: new Date().toISOString(),
          encryptedMessage: "[fixture message]",
          nick: myNick || "Your robot",
          plaintext: text,
          mine: true,
          decryptFailed: false,
          signatureStatus: "unknown"
        }
      ]);
      setDraft("");
      return;
    }
    if (!baseUrl || !stableAuth || !robotPrivateKey || !robotPublicKey || !slotToken) {
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

    stickToLatestRef.current = true;
    setNewMessageCount(0);
    setSending(true);
    try {
      const outgoingMessage = sendsPlaintextCommand
        ? text
        : await encryptChatMessage({
            message: text,
            ownPrivateKeyArmored: robotPrivateKey,
            passphrase: slotToken,
            peerPublicKeyArmored: currentPeerPubkey
          });
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({ type: "message", message: escapeChatPayload(outgoingMessage), nick: canonicalMyNick })
        );
      } else {
        const response = await postChatMessage(baseUrl, orderId, outgoingMessage, lastIndex, stableAuth);
        applyPresenceObservation(response.peerConnected, true, presenceRevisionRef, setPeerConnected);
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
    const responsePeerPubkey = usablePeerPublicKey(response.peerPubkey, robotPublicKey ?? "");
    if (responsePeerPubkey) {
      peerPubkeyRef.current = responsePeerPubkey;
      setPeerPubkey(responsePeerPubkey);
    }
    if (!robotPrivateKey || !robotPublicKey || !slotToken) return;

    let feedbackDelivered = false;
    await decryptChatMessagesNewestFirst(
      response.messages,
      {
        ownCoordinatorNick: canonicalMyNick,
        ownPrivateKeyArmored: robotPrivateKey,
        ownPublicKeyArmored: robotPublicKey,
        passphrase: slotToken,
        peerPublicKeyArmored: responsePeerPubkey || peerPubkeyRef.current,
        senderOnlyResponse: isPreChat
      },
      (decryptedMessages) => {
        const visibleMessages = isPreChat ? visiblePreChatMessages(decryptedMessages) : decryptedMessages;
        const newPeerMessages = visibleMessages.filter(
          (message) => !knownMessageIndexesRef.current.has(message.index) && !message.mine && !message.decryptFailed
        );
        visibleMessages.forEach((message) => knownMessageIndexesRef.current.add(message.index));
        setMessages((current) => mergeMessages(current, visibleMessages));
        if (!feedbackDelivered && notifyNewMessages && newPeerMessages.length > 0) {
          const latest = newPeerMessages.at(-1);
          setMessageAnnouncement(`New message from ${latest?.nick || peerNick}: ${latest?.plaintext || ""}`);
        }
        if (!feedbackDelivered && !isPreChat && notifyNewMessages && shortAlias && newPeerMessages.length > 0) {
          deliverChatFeedback({
            lastIndex: Math.max(...newPeerMessages.map((message) => message.index)),
            orderId,
            peerName: newPeerMessages.at(-1)?.nick || peerNick,
            robotHashId: myHashId,
            shortAlias
          });
        }
        if (notifyNewMessages && newPeerMessages.length > 0) feedbackDelivered = true;
      }
    );
  }

  useEffect(() => {
    if (!canLoad || previewMode || isPreChat) return;
    void loadMessages(0, true, { timeoutProfile: "interactive", priority: "foreground" });
  }, [canLoad, connectionEpoch, isPreChat, loadMessages, orderId, previewMode]);

  usePreChatReconciliation({
    canLoad,
    previewMode,
    isPreChat,
    connectionEpoch,
    orderId,
    loadMessages,
    hasUsablePeerKey,
    setError,
    setHistoryStatus
  });

  useEffect(() => {
    if (isPreChat || !canLoad || previewMode) return;
    let disposed = false;
    let timer: number | undefined;
    const schedule = () => {
      if (disposed) return;
      if (document.hidden && isNativeApp()) return;
      timer = window.setTimeout(
        async () => {
          await loadMessages(lastIndexRef.current, false);
          schedule();
        },
        chatPollDelayMs(socketConnected, document.hidden)
      );
    };
    schedule();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [canLoad, isPreChat, loadMessages, orderId, previewMode, socketConnected]);

  useEffect(() => {
    if (variant === "pre-chat" || !canLoad || previewMode || !baseUrl || !robotPublicKey || !slotToken) return;

    let disposed = false;
    let reconnectTimer: number | undefined;
    let attempts = 0;

    const connect = () => {
      if (disposed) return;
      const socket = createWebSocket(buildChatSocketUrl(baseUrl, orderId, slotToken));
      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        attempts = 0;
        setSocketConnected(true);
        socket.send(JSON.stringify({ type: "message", message: robotPublicKey, nick: canonicalMyNick }));
        if (!historyReadyRef.current) {
          void loadMessages(0, false);
        } else if (lastIndexRef.current > 0) {
          void loadMessages(lastIndexRef.current, false);
        }
      };
      socket.onmessage = (event) => {
        if (socketRef.current !== socket) return;
        attempts = 0;
        void applySocketMessage(socket, String(event.data));
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        if (socketRef.current === socket) socketRef.current = undefined;
        setSocketConnected(false);
        presenceRevisionRef.current += 1;
        setPeerConnected(undefined);
        if (disposed) return;
        attempts += 1;
        reconnectTimer = window.setTimeout(connect, chatReconnectDelayMs(attempts));
      };
    };

    const applySocketMessage = async (socket: WebSocket, raw: string) => {
      try {
        if (socketRef.current !== socket) return;
        const data = JSON.parse(raw) as Record<string, unknown>;
        const peerIsConnected = normalizePeerConnected(data.peer_connected);
        applyPresenceObservation(peerIsConnected, true, presenceRevisionRef, setPeerConnected);
        const message = normalizeChatMessage(data);
        if (!message.encryptedMessage) return;

        if (message.encryptedMessage.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
          const socketPeerPubkey = usablePeerPublicKey(message.encryptedMessage, robotPublicKey);
          if (socketPeerPubkey) {
            peerPubkeyRef.current = socketPeerPubkey;
            setPeerPubkey(socketPeerPubkey);
            socketRef.current?.send(
              JSON.stringify({ type: "message", message: "-----SERVE HISTORY-----", nick: canonicalMyNick })
            );
          }
          return;
        }

        if (!isDisplayableChatPayload(message.encryptedMessage)) return;

        await applyChatResponse({
          peerConnected: undefined,
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
      presenceRevisionRef.current += 1;
      setSocketConnected(false);
      setPeerConnected(undefined);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = undefined;
    };
  }, [
    baseUrl,
    canLoad,
    canonicalMyNick,
    connectionEpoch,
    loadMessages,
    orderId,
    previewMode,
    robotPublicKey,
    slotToken,
    variant
  ]);

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
              <strong>You</strong>
              <small title={myNick || "Your robot"}>{myNick || "Your robot"}</small>
            </span>
          </div>
          <span className="chat-participant-divider" aria-hidden>
            trading with
          </span>
          <div
            aria-label={`Trade peer: ${peerNick || "Trade peer"}`}
            className="chat-participant chat-participant-peer"
            tabIndex={0}
          >
            <RobotAvatar hashId={peerHashId} label={peerNick || "Trade peer"} size="sm" />
            <span>
              <strong title={peerNick || "Trade peer"}>{peerNick || "Trade peer"}</strong>
              <small>Trade peer</small>
            </span>
          </div>
          {!isPreChat && hasLivePresence ? presenceLabel(peerConnected, peerNick) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!canLoad ? (
          <p className="muted-copy">Load this live order with your robot keys to decrypt chat.</p>
        ) : (
          <div className="chat-stack">
            <span aria-live="polite" className="sr-only" role="status">
              {messageAnnouncement}
            </span>
            <div
              aria-label="Trade chat history"
              className="chat-messages"
              onScroll={handleScroll}
              ref={messagesRef}
              role="log"
            >
              {shouldShowChatLoading(messages.length, historyStatus, isPreChat) ? (
                <div className="chat-loading" role="status">
                  <span className="ui-spinner" aria-hidden="true" />
                  <span>{isPreChat ? "Loading early message..." : "Loading chat..."}</span>
                </div>
              ) : null}
              {messages.length === 0 && historyStatus === "ready" ? (
                <p className="chat-empty">{isPreChat ? "No early message sent." : "No chat messages yet."}</p>
              ) : null}
              {visibleMessages.map((message) => (
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

            <NewChatMessagesButton count={newMessageCount} onClick={scrollToLatest} />

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
                rows={1}
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
            ) : (
              renderPreChatStatus(isPreChat, peerPubkey, historyStatus, messages.length)
            )}
            {error ? (
              <p className="field-error" id={errorId} role="alert">
                {error}
              </p>
            ) : null}
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
    if (!robotPrivateKey || !robotPublicKey || !slotToken) return;
    if (
      !window.confirm(
        "This chat log file contains the private chat key and robot passphrase. Store it securely and share it only with the dispute coordinator."
      )
    )
      return;
    const chatLogs = {
      version: 1,
      order_id: orderId,
      exported_at: new Date().toISOString(),
      credentials: {
        own_public_key: robotPublicKey,
        peer_public_key: peerPubkey,
        encrypted_private_key: robotPrivateKey,
        passphrase: slotToken
      },
      messages: messages.map(({ index, time, encryptedMessage, nick }) => ({
        index,
        time,
        message: encryptedMessage,
        nick
      }))
    };
    downloadChatLogs(orderId, chatLogs);
  }
}

export function PreChatDisclosure(props: Omit<Parameters<typeof ChatStagePanel>[0], "variant">) {
  const [open, setOpen] = useState(false);

  return (
    <details className="pre-chat-disclosure" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
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
      <ChatStagePanel key={`${props.orderId}:${props.peerHashId || props.peerNick}`} {...props} variant="pre-chat" />
    </details>
  );
}

const PRE_CHAT_MAX_ATTEMPTS = 3;

const VISIBLE_MESSAGE_WINDOW = 50;
const CHAT_DECRYPT_BATCH_SIZE = VISIBLE_MESSAGE_WINDOW;

function makeScrollHandler(
  ref: React.RefObject<HTMLDivElement | null>,
  anchorRef: React.MutableRefObject<{ scrollHeight: number; scrollTop: number } | undefined>,
  maxMessages: number,
  visibleCount: number,
  expand: (fn: (current: number) => number) => void
): () => void {
  return () => {
    const element = ref.current;
    if (!element || anchorRef.current || visibleCount >= maxMessages || element.scrollTop >= element.clientHeight * 2)
      return;
    anchorRef.current = { scrollHeight: element.scrollHeight, scrollTop: element.scrollTop };
    expand((current) => Math.min(current + VISIBLE_MESSAGE_WINDOW, maxMessages));
  };
}

export function restoredExpandedScrollTop(previousTop: number, previousHeight: number, nextHeight: number): number {
  return previousTop + Math.max(0, nextHeight - previousHeight);
}

function preChatRetryDelay(attempt: number): number {
  return Math.min(12_000, 1_500 * 2 ** Math.min(attempt, 3));
}

interface PreChatReconciliationParams {
  canLoad: boolean;
  previewMode: boolean;
  isPreChat: boolean;
  connectionEpoch: number;
  orderId: number;
  loadMessages: (
    offset: number,
    reportError: boolean,
    options?: ApiRequestOptions
  ) => Promise<ChatResponse | undefined>;
  hasUsablePeerKey: () => boolean;
  setError: (message: string) => void;
  setHistoryStatus: (status: ChatHistoryStatus) => void;
}

function usePreChatReconciliation({
  canLoad,
  previewMode,
  isPreChat,
  connectionEpoch,
  orderId,
  loadMessages,
  hasUsablePeerKey,
  setError,
  setHistoryStatus
}: PreChatReconciliationParams): void {
  useEffect(() => {
    if (!canLoad || previewMode || !isPreChat || hasUsablePeerKey()) return;
    let disposed = false;
    let retryTimer: number | undefined;

    const reconcile = async (attempt: number) => {
      const finalAttempt = attempt + 1 >= PRE_CHAT_MAX_ATTEMPTS;
      const response = await loadMessages(
        0,
        finalAttempt,
        attempt === 0
          ? { timeoutProfile: "interactive", priority: "foreground" }
          : { timeoutProfile: "background", priority: "visible" }
      );
      if (disposed || hasUsablePeerKey()) return;
      if (finalAttempt) {
        setHistoryStatus(response ? "unavailable" : "error");
        return;
      }
      setHistoryStatus("loading");
      retryTimer = window.setTimeout(() => void reconcile(attempt + 1), preChatRetryDelay(attempt));
    };

    setError("");
    setHistoryStatus("loading");
    void reconcile(0);
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [
    canLoad,
    connectionEpoch,
    hasUsablePeerKey,
    isPreChat,
    loadMessages,
    orderId,
    previewMode,
    setError,
    setHistoryStatus
  ]);
}

function renderPreChatStatus(
  isPreChat: boolean,
  peerPubkey: string | undefined,
  historyStatus: string,
  messageCount: number
): ReactNode {
  if (!isPreChat || peerPubkey) return null;
  if (historyStatus === "error") return null;
  if ((historyStatus === "ready" || historyStatus === "unavailable") && messageCount === 0) {
    return (
      <p className="muted-copy" role="status">
        Encrypted messaging will be available when the trade chat opens.
      </p>
    );
  }
  return (
    <p className="pre-chat-key-status" role="status">
      <span className="ui-spinner" aria-hidden="true" />
      Preparing encrypted messaging...
    </p>
  );
}

function copyAuth(auth?: Auth): Auth | undefined {
  if (!auth) return undefined;
  return {
    tokenSHA256: auth.tokenSHA256,
    nostrPubkey: auth.nostrPubkey,
    keys: auth.keys ? { pubKey: auth.keys.pubKey, encPrivKey: auth.keys.encPrivKey } : undefined
  };
}

function hasLiveChatCredentials(
  baseUrl: string | undefined,
  auth: Auth | undefined,
  privateKey: string | undefined,
  publicKey: string | undefined,
  slotToken: string | undefined,
  orderId: number
): boolean {
  return Boolean(baseUrl && auth && privateKey && publicKey && slotToken && orderId);
}

function shouldShowChatLoading(messageCount: number, status: ChatHistoryStatus, isPreChat: boolean): boolean {
  return messageCount === 0 && status === "loading" && !isPreChat;
}

function previewChatMessages(myNick: string, peerNick: string): DisplayChatMessage[] {
  const now = Date.now();
  return [
    {
      index: 1,
      time: new Date(now - 120_000).toISOString(),
      encryptedMessage: "[fixture message]",
      nick: peerNick || "Trade peer",
      plaintext: "Hi. I am ready to complete the payment.",
      mine: false,
      decryptFailed: false,
      signatureStatus: "unknown"
    },
    {
      index: 2,
      time: new Date(now - 60_000).toISOString(),
      encryptedMessage: "[fixture message]",
      nick: myNick || "Your robot",
      plaintext: "Ready here too. I will confirm as soon as it is sent.",
      mine: true,
      decryptFailed: false,
      signatureStatus: "unknown"
    }
  ];
}

function downloadChatLogs(orderId: number, value: unknown) {
  downloadTextFile(`robosats-order-${orderId}-chat-logs.json`, JSON.stringify(value, null, 2), "application/json");
}

function buildChatSocketUrl(baseUrl: string, orderId: number, token: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/chat/${orderId}/`;
  url.search = `token_sha256_hex=${sha256(token)}`;
  return url.toString();
}

const MessageBubble = memo(function MessageBubble({
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
        {message.signatureStatus === "verified" ? (
          <span className="chat-signature-status">Signature verified</span>
        ) : message.signatureStatus === "unverified" ? (
          <span className="chat-signature-status">Signature could not be verified</span>
        ) : null}
      </div>
    </article>
  );
});

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
  const mine = isOwnChatMessage(message.nick, keys.ownCoordinatorNick, keys.senderOnlyResponse);
  if (message.encryptedMessage.startsWith("#")) {
    return {
      ...message,
      decryptFailed: false,
      mine,
      plaintext: message.encryptedMessage,
      signatureStatus: "unknown"
    };
  }

  try {
    const decrypted = await decryptChatMessage({
      armoredMessage: message.encryptedMessage,
      ownPrivateKeyArmored: keys.ownPrivateKeyArmored,
      passphrase: keys.passphrase,
      expectedSignerPublicKeyArmored: mine ? keys.ownPublicKeyArmored : keys.peerPublicKeyArmored
    });
    return {
      ...message,
      decryptFailed: false,
      mine,
      plaintext: decrypted.plaintext,
      signatureStatus: decrypted.signatureStatus
    };
  } catch {
    return {
      ...message,
      decryptFailed: true,
      mine,
      plaintext: "Encrypted message could not be decrypted.",
      signatureStatus: "unknown"
    };
  }
}

export async function decryptChatMessagesNewestFirst(
  messages: ChatMessage[],
  keys: Parameters<typeof decryptDisplayMessage>[1],
  onBatch: (messages: DisplayChatMessage[]) => void,
  yieldControl: () => Promise<void> = yieldToMainThread
): Promise<void> {
  const orderedMessages = [...messages].sort((left, right) => left.index - right.index);
  for (let end = orderedMessages.length; end > 0; end -= CHAT_DECRYPT_BATCH_SIZE) {
    const start = Math.max(0, end - CHAT_DECRYPT_BATCH_SIZE);
    const batch = await Promise.all(
      orderedMessages.slice(start, end).map((message) => decryptDisplayMessage(message, keys))
    );
    onBatch(batch);
    if (start > 0) await yieldControl();
  }
}

function maxMessageIndex(messages: Array<{ index: number }>): number {
  return messages.reduce((maximum, message) => Math.max(maximum, message.index), Number.NEGATIVE_INFINITY);
}

async function yieldToMainThread(): Promise<void> {
  const scheduler = globalThis.scheduler as { yield?: () => Promise<void> } | undefined;
  if (scheduler?.yield) {
    await scheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

const signatureRank = { unknown: 0, unverified: 1, verified: 2 } as const;

function NewChatMessagesButton({ count, onClick }: { count: number; onClick: () => void }) {
  if (count <= 0) return null;
  return (
    <button className="chat-new-messages" onClick={onClick} type="button">
      {count} new {count === 1 ? "message" : "messages"}
      <ChevronDown size={15} aria-hidden="true" />
    </button>
  );
}

function updateUnreadMessageState({
  addedCount,
  element,
  messagesRef,
  previousCount,
  setNewMessageCount,
  stickToLatest,
  unreadCount
}: {
  addedCount: number;
  element: HTMLDivElement | null;
  messagesRef: { current: HTMLDivElement | null };
  previousCount: number;
  setNewMessageCount: (update: number | ((current: number) => number)) => void;
  stickToLatest: boolean;
  unreadCount: number;
}) {
  if (!element || addedCount === 0) return;
  if (previousCount === 0 || stickToLatest) {
    window.requestAnimationFrame(() => {
      const latest = messagesRef.current;
      if (latest) latest.scrollTop = latest.scrollHeight;
    });
    setNewMessageCount(0);
    return;
  }
  if (unreadCount > 0) setNewMessageCount((current) => current + unreadCount);
}

export function mergeMessages(current: DisplayChatMessage[], incoming: DisplayChatMessage[]): DisplayChatMessage[] {
  const byIndex = new Map(current.map((message) => [message.index, message]));
  for (const message of incoming) {
    const previous = byIndex.get(message.index);
    if (!previous || (previous.decryptFailed && !message.decryptFailed)) {
      byIndex.set(message.index, message);
      continue;
    }
    if (!previous.decryptFailed && message.decryptFailed) continue;
    if (signatureRank[message.signatureStatus] > signatureRank[previous.signatureStatus])
      byIndex.set(message.index, message);
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

const chatTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit"
});

function formatChatTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return chatTimeFormatter.format(date);
}

function presenceLabel(peerConnected: boolean | undefined, peerNick: string) {
  if (peerConnected === undefined) return null;
  const status = peerConnected ? "Online" : "Offline";
  return (
    <span
      aria-label={`${peerNick || "Trade peer"} is ${status.toLowerCase()}`}
      aria-live="polite"
      className={peerConnected ? "chat-presence chat-presence-online" : "chat-presence"}
      role="status"
    >
      {status}
    </span>
  );
}

function applyPresenceObservation(
  observation: boolean | undefined,
  allowed: boolean,
  revision: { current: number },
  setPresence: (value: boolean | undefined) => void
): void {
  if (!allowed || observation === undefined) return;
  revision.current += 1;
  setPresence(observation);
}
