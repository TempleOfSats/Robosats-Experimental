import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

export const CASH_F2F_METHOD = "Cash F2F";

const GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";
const APPROXIMATION_STEP = 0.1;

export function paymentMethodHasF2F(paymentMethod: string): boolean {
  return paymentMethod.toLowerCase().includes(CASH_F2F_METHOD.toLowerCase());
}

export function isCashF2FMethod(paymentMethod: string): boolean {
  return paymentMethod.trim().toLowerCase() === CASH_F2F_METHOD.toLowerCase();
}

export function selectCashF2FOffers(orders: PublicOrder[]): PublicOrder[] {
  return orders.filter((order) => !order.is_swap && paymentMethodHasF2F(order.payment_method));
}

export function hasApproximateF2FLocation(
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined
): boolean {
  const lat = Number(latitude);
  const lon = Number(longitude);
  return (
    Number.isFinite(lat)
    && Number.isFinite(lon)
    && lat >= -90
    && lat <= 90
    && lon >= -180
    && lon <= 180
    && (lat !== 0 || lon !== 0)
  );
}

export function approximateF2FLocation(latitude: number, longitude: number): [number, number] {
  return [
    clamp(roundToStep(latitude, APPROXIMATION_STEP), -89.9, 89.9),
    clamp(roundToStep(longitude, APPROXIMATION_STEP), -180, 180)
  ];
}

export function formatApproximateF2FLocation(latitude: number, longitude: number): string {
  return `${formatCoordinate(latitude, "N", "S")}, ${formatCoordinate(longitude, "E", "W")}`;
}

export function decodeGeohashCenter(geohash: string): [number, number] | undefined {
  const normalized = geohash.trim().toLowerCase();
  if (!normalized) return undefined;

  let longitudeRange: [number, number] = [-180, 180];
  let latitudeRange: [number, number] = [-90, 90];
  let refineLongitude = true;

  for (const character of normalized) {
    const value = GEOHASH_ALPHABET.indexOf(character);
    if (value < 0) return undefined;

    for (const mask of [16, 8, 4, 2, 1]) {
      const range = refineLongitude ? longitudeRange : latitudeRange;
      const midpoint = (range[0] + range[1]) / 2;
      if (value & mask) range[0] = midpoint;
      else range[1] = midpoint;
      refineLongitude = !refineLongitude;
    }
  }

  return [
    (latitudeRange[0] + latitudeRange[1]) / 2,
    (longitudeRange[0] + longitudeRange[1]) / 2
  ];
}

function roundToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(1));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(1)}°${value < 0 ? negative : positive}`;
}
