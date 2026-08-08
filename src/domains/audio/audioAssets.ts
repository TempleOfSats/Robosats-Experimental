export type TradeAudioEvent = "chat-open" | "locked-invoice" | "successful" | "taker-found";

export function tradeAudioEventForOrderTransition(
  previousStatus: number | undefined,
  status: number
): TradeAudioEvent | null {
  if (previousStatus === undefined || previousStatus === status) return null;
  return status === 6 ? "taker-found" : "locked-invoice";
}
