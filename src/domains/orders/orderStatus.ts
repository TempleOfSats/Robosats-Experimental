import type { OrderDto } from "@/domains/orders/order.types";

export function tradeStatusLabel(order: Pick<OrderDto, "status" | "status_message">): string {
  const labels: Record<number, string> = {
    0: "Publishing",
    1: "Waiting for taker",
    2: "Taker found",
    3: "Awaiting bond",
    4: "Cancelled",
    5: "Expired",
    6: "Setup in progress",
    7: "Setup in progress",
    8: "Setup in progress",
    9: "Sending fiat",
    10: "Fiat sent",
    11: "In dispute",
    12: "Collaboratively cancelled",
    13: "Sending payout",
    14: "Trade complete",
    15: "Payout retry",
    16: "Under review",
    17: "Dispute resolved",
    18: "Dispute resolved"
  };
  return labels[order.status] ?? order.status_message ?? "Trade active";
}
