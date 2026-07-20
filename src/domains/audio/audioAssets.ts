export type TradeAudioEvent = "chat-open" | "locked-invoice" | "successful" | "taker-found";

export const tradeAudioAssets: Record<TradeAudioEvent, string> = {
  "chat-open": "/static/assets/sounds/chat-open.mp3",
  "locked-invoice": "/static/assets/sounds/locked-invoice.mp3",
  successful: "/static/assets/sounds/successful.mp3",
  "taker-found": "/static/assets/sounds/taker-found.mp3"
};

export function notificationAudioEvent(status: number): TradeAudioEvent {
  if (status === 6) return "taker-found";
  if ([13, 14, 15].includes(status)) return "successful";
  return "locked-invoice";
}

export function tradeAudioEventForOrderTransition(
  previousStatus: number | undefined,
  status: number
): TradeAudioEvent | null {
  if (previousStatus === undefined || previousStatus === status) return null;
  return notificationAudioEvent(status);
}
