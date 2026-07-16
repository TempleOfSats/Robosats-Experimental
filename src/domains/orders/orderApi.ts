import { apiRoutes, type Auth, type ApiClient } from "@/domains/transport/apiClient";
import { apiClient } from "@/domains/transport/apiWebClient";
import { normalizeOrderDto, type OrderApiResponse } from "@/domains/orders/orderModel";
import type { OrderDto, SubmitOrderActionPayload } from "@/domains/orders/order.types";

export async function fetchOrder(
  baseUrl: string,
  orderId: number,
  auth: Auth,
  client: ApiClient = apiClient
): Promise<OrderDto> {
  const data = await client.get<OrderApiResponse>(baseUrl, apiRoutes.order(orderId), auth);
  return normalizeOrderDto(data);
}

export async function submitOrderAction(
  baseUrl: string,
  orderId: number,
  payload: SubmitOrderActionPayload,
  auth: Auth,
  client: ApiClient = apiClient
): Promise<OrderDto> {
  const data = await client.post<OrderApiResponse>(
    baseUrl,
    apiRoutes.order(orderId),
    compactPayload(payload),
    { tokenSHA256: auth.tokenSHA256 }
  );
  return normalizeOrderDto(data);
}

export function compactPayload(payload: SubmitOrderActionPayload): SubmitOrderActionPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as SubmitOrderActionPayload;
}
