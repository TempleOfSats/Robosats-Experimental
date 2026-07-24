import { currencyCodeFromId } from "@/domains/orderbook/currencies";
import { matchedPaymentMethods } from "@/domains/orderbook/paymentMethods";
import { getTradeViewState } from "@/domains/orders/orderStateMachine";
import { roleIntentLabel, type TradeRole } from "@/domains/orders/orderRole";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";
import { classifyProTrade, type ProTradeGroup } from "@/domains/pro/proSelectors";
import { formatFiat } from "@/lib/format";

export type ProTradePresentation = {
  group: ProTradeGroup;
  statusLabel: string;
  statusTone: ProStatusTone;
  statusIcon: LucideIcon;
  directionLabel: string;
  amountLabel: string;
  methodLabel: string;
  deadline?: number;
  actionable: boolean;
};

export type ProStatusTone = "default" | "success" | "warning" | "danger" | "muted";

export function toProTradePresentation(snapshot: ProTradeSnapshot): ProTradePresentation {
  const group = classifyProTrade(snapshot);
  const order = snapshot.order;
  if (!order) {
    return {
      group,
      statusLabel: snapshot.freshness === "error" ? "Refresh failed" : "Trade unavailable",
      statusTone: "muted",
      statusIcon: WifiOff,
      directionLabel: "Trade",
      amountLabel: "Amount unavailable",
      methodLabel: "Method unavailable",
      actionable: false
    };
  }

  const view = getTradeViewState(order);
  const role: TradeRole = order.is_taker ? "taker" : "maker";
  const deadline = Date.parse(order.expires_at);
  return {
    group,
    statusLabel: snapshot.freshness === "error" ? `${view.title} · Stale` : view.title,
    statusTone: statusTone(view.tone, snapshot.freshness),
    statusIcon: statusIcon(group, view.tone, snapshot.freshness),
    directionLabel: roleIntentLabel(order.type, order.currency === 1000, role),
    amountLabel: formatOrderAmount(order),
    methodLabel: formatPaymentMethods(order.payment_method),
    deadline: Number.isFinite(deadline) ? deadline : undefined,
    actionable: group === "needs-action"
  };
}

function statusIcon(
  group: ProTradeGroup,
  tone: ReturnType<typeof getTradeViewState>["tone"],
  freshness: ProTradeSnapshot["freshness"]
): LucideIcon {
  if (freshness === "error" || freshness === "stale") return WifiOff;
  if (freshness === "refreshing") return RefreshCw;
  if (group === "renewable") return RotateCcw;
  if (group === "needs-action" || tone === "danger" || tone === "warning") return AlertTriangle;
  if (tone === "success") return CircleCheck;
  return Clock3;
}

function formatOrderAmount(order: NonNullable<ProTradeSnapshot["order"]>): string {
  const currency = currencyCodeFromId(order.currency) ?? "";
  if (order.has_range && order.min_amount != null && order.max_amount != null) {
    return `${formatFiat(order.min_amount)} - ${formatFiat(order.max_amount, currency)}`;
  }
  return formatFiat(order.amount, currency);
}

function formatPaymentMethods(value: string): string {
  const labels = matchedPaymentMethods(value).map((method) => method.name);
  if (labels.length > 0) return labels.join(", ");
  return value.trim() || "Not specified";
}

function statusTone(
  tone: ReturnType<typeof getTradeViewState>["tone"],
  freshness: ProTradeSnapshot["freshness"]
): ProStatusTone {
  if (freshness === "error" || freshness === "stale") return "muted";
  if (tone === "default") return "default";
  return tone;
}
import { AlertTriangle, CircleCheck, Clock3, RefreshCw, RotateCcw, WifiOff, type LucideIcon } from "lucide-react";
