import { currencyCodeFromId } from "@/domains/orderbook/currencies";
import { orderReferenceSats } from "@/domains/orders/orderModel";
import type { OrderDto, TradeViewState } from "@/domains/orders/order.types";
import { formatFiat, formatSats } from "@/lib/format";

export function shouldShowFinishedReceipt(order: OrderDto, view: TradeViewState): boolean {
  return (
    view.panel === "success" ||
    view.panel === "dispute_won" ||
    view.panel === "dispute_lost" ||
    order.status === 4 ||
    order.status === 12
  );
}

export function tradeFiatText(order: Pick<OrderDto, "amount" | "currency">): string | undefined {
  if (typeof order.amount !== "number" || !Number.isFinite(order.amount)) return undefined;
  const currency = currencyCodeFromId(order.currency) ?? String(order.currency || "");
  return formatFiat(order.amount, currency);
}

export function tradeSatsText(order: OrderDto): string | undefined {
  const value = orderReferenceSats(order);
  return Number.isFinite(value) && value > 0 ? formatSats(value) : undefined;
}
