import { approximateF2FLocation, hasApproximateF2FLocation, paymentMethodHasF2F } from "@/domains/location/f2fLocation";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

export type F2FOfferGroup = {
  key: string;
  latitude: number;
  longitude: number;
  orders: PublicOrder[];
};

export function selectCashF2FOffers(orders: PublicOrder[]): PublicOrder[] {
  return orders.filter((order) => !order.is_swap && paymentMethodHasF2F(order.payment_method));
}

export function groupCashF2FOffers(orders: PublicOrder[]): F2FOfferGroup[] {
  const groups = new Map<string, F2FOfferGroup>();

  for (const order of selectCashF2FOffers(orders)) {
    if (!hasApproximateF2FLocation(order.latitude, order.longitude)) continue;
    const [latitude, longitude] = approximateF2FLocation(
      Number(order.latitude),
      Number(order.longitude)
    );
    const key = `${latitude.toFixed(1)}:${longitude.toFixed(1)}`;
    const existing = groups.get(key);
    if (existing) existing.orders.push(order);
    else groups.set(key, { key, latitude, longitude, orders: [order] });
  }

  return [...groups.values()].sort((left, right) => (
    right.orders.length - left.orders.length
    || right.latitude - left.latitude
    || left.longitude - right.longitude
  ));
}
