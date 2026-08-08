import { playTradeAudio } from "@/domains/audio/audioController";
import { showDesktopOrderNotification } from "@/domains/notifications/desktopNotifications";
import { shouldPlayOrderFeedbackAudio } from "@/domains/notifications/orderFeedbackVisibility";

const MAX_CHAT_TRACKERS = 64;
const lastNotifiedChatIndex = new Map<string, number>();

export function deliverChatFeedback({
  lastIndex,
  orderId,
  peerName,
  robotHashId,
  shortAlias
}: {
  lastIndex: number;
  orderId: number;
  peerName?: string;
  robotHashId?: string;
  shortAlias: string;
}): void {
  if (!Number.isSafeInteger(lastIndex) || lastIndex <= 0) return;
  const key = `${robotHashId || "unknown"}:${shortAlias}:${orderId}`;
  const previous = lastNotifiedChatIndex.get(key) ?? 0;
  if (lastIndex <= previous) return;
  lastNotifiedChatIndex.delete(key);
  lastNotifiedChatIndex.set(key, lastIndex);
  while (lastNotifiedChatIndex.size > MAX_CHAT_TRACKERS) {
    const oldest = lastNotifiedChatIndex.keys().next().value;
    if (!oldest) break;
    lastNotifiedChatIndex.delete(oldest);
  }

  const messageText = peerName ? `New message from ${peerName}` : "New trade chat message";
  if (shouldPlayOrderFeedbackAudio(shortAlias, orderId)) {
    void playTradeAudio("chat-open").catch(() => undefined);
  }
  void showDesktopOrderNotification(orderId, shortAlias, messageText, robotHashId);
}

export function resetTradeFeedbackForTests(): void {
  lastNotifiedChatIndex.clear();
}
