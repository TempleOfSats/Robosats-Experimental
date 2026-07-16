import type { TradeViewState } from "@/domains/orders/order.types";

const tradeMotion = {
  statusFlash: "trade-status-flash",
  locked: "trade-locked-transition",
  payoutSuccess: "trade-payout-success"
} as const;

export function tradeMotionClass(view: Pick<TradeViewState, "bondStatus" | "status">): string {
  if (view.status === 14) return tradeMotion.payoutSuccess;
  if (view.bondStatus === "locked") return tradeMotion.locked;
  return tradeMotion.statusFlash;
}
