export type TradeAudioEvent =
  | "chat-open"
  | "locked-invoice"
  | "order-cancelled"
  | "order-collab-cancelled"
  | "order-dispute-opened"
  | "order-paused"
  | "order-resumed"
  | "rewards-withdrawal-success"
  | "successful"
  | "taker-found";

export function tradeAudioEventForOrderTransition(
  previousStatus: number | undefined,
  status: number
): TradeAudioEvent | null {
  if (previousStatus === undefined || previousStatus === status) return null;
  if (status === 2) return "order-paused";
  if (previousStatus === 2 && status === 1) return "order-resumed";
  if (status === 4) return "order-cancelled";
  if (status === 12) return "order-collab-cancelled";
  if (status === 11) return "order-dispute-opened";
  return status === 6 ? "taker-found" : "locked-invoice";
}
