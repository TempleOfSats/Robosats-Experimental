export type TradeAudioEvent = "chat-open" | "locked-invoice" | "successful" | "taker-found";

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
