import { Check } from "lucide-react";
import {
  disputeOutcomeForCurrentRobot,
  hasFailedPayoutForCurrentRobot,
  isCompletedTradeForCurrentRobot
} from "@/domains/orders/orderStateMachine";
import type { OrderDto } from "@/domains/orders/order.types";

export function TradeProgress({ order }: { order: OrderDto }) {
  const labels = order.is_taker
    ? ["Take", "Setup", "Trade", "Finish"]
    : ["Publish", "Wait", "Setup", "Trade", "Finish"];
  const activeIndex = tradeStepIndex(order);

  return (
    <div className={`trade-progress trade-progress-${labels.length}`} aria-label="Trade progress">
      {labels.map((label, i) => {
        const state = progressStateForIndex(i, activeIndex, order);
        return (
          <div
            aria-current={state === "active" || state === "danger" || state === "waiting" ? "step" : undefined}
            data-state={state}
            key={label}
            className={`trade-progress-step ${state}`}
          >
            <span className="trade-progress-dot">
              {state === "complete" ? <Check size={14} /> : <span>{i + 1}</span>}
            </span>
            <span className="trade-progress-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function tradeStepIndex(order: OrderDto): number {
  if (!order.is_taker && [1, 2, 3].includes(order.status)) return 1;
  if ([6, 7, 8].includes(order.status)) return order.is_taker ? 1 : 2;
  if ([9, 10, 11, 12].includes(order.status)) return order.is_taker ? 2 : 3;
  if ([13, 14, 15, 16, 17, 18].includes(order.status)) return order.is_taker ? 3 : 4;
  return 0;
}

function progressStateForIndex(index: number, activeIndex: number, order: OrderDto): string {
  const disputeOutcome = disputeOutcomeForCurrentRobot(order);
  const disputeLost = disputeOutcome === "lost";
  const failedPayout = hasFailedPayoutForCurrentRobot(order);
  const payoutRetrying = failedPayout && !order.invoice_expired;
  const completed = isCompletedTradeForCurrentRobot(order) || disputeOutcome === "won";
  if (failedPayout || disputeLost) {
    if (index === activeIndex) return payoutRetrying ? "waiting" : "danger";
  }
  if (completed && index <= activeIndex) return "complete";
  if (index < activeIndex) return "complete";
  if (index === activeIndex) return "active";
  return "pending";
}
