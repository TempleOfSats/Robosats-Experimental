import type { NavigateFunction } from "react-router-dom";
import { beginRouteTransition } from "@/domains/navigation/routeTransition";
import type { OrderDto } from "@/domains/orders/order.types";
import { useOrderStore } from "@/domains/orders/orderStore";

export function openConfirmedOrder(
  navigate: NavigateFunction,
  {
    initialOrder,
    orderId,
    shortAlias,
    slotId
  }: {
    initialOrder?: OrderDto;
    orderId: number;
    shortAlias: string;
    slotId: string;
  }
): string {
  const path = `/order/${shortAlias}/${orderId}`;
  const orderStore = useOrderStore.getState();
  if (initialOrder) {
    orderStore.primeOrder({ ...initialOrder, id: orderId, shortAlias });
  } else {
    orderStore.clearOrder();
  }

  beginRouteTransition(path);
  navigate(path, { state: { robotSlotId: slotId } });
  return path;
}
