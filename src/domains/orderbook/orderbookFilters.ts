import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

type OrderSideFilter = "all" | "buy" | "sell";

export interface OrderFilterOptions {
  side: OrderSideFilter;
  coordinator: string;
}

export function filterPublicOrders(orders: PublicOrder[], filters: OrderFilterOptions): PublicOrder[] {
  return orders.filter((order) => {
    if (filters.side === "buy" && order.type !== 1) return false;
    if (filters.side === "sell" && order.type !== 0) return false;
    if (filters.coordinator !== "all" && order.coordinatorShortAlias !== filters.coordinator) return false;

    return true;
  });
}

export function coordinatorFilterOptions(orders: PublicOrder[]): string[] {
  return [...new Set(orders.map((order) => order.coordinatorShortAlias).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
}
