import { apiRoutes, type ApiRequestOptions, type Auth, type ApiClient } from "@/domains/transport/apiClient";
import { apiClient } from "@/domains/transport/apiWebClient";
import { normalizeOrderDto, type OrderApiResponse } from "@/domains/orders/orderModel";
import type { OrderDto, SubmitOrderActionPayload } from "@/domains/orders/order.types";

const actionResponseCompleteness = new WeakMap<OrderDto, boolean>();

export async function fetchOrder(
  baseUrl: string,
  orderId: number,
  auth: Auth,
  options?: ApiRequestOptions,
  client: ApiClient = apiClient
): Promise<OrderDto> {
  const data = await client.get<OrderApiResponse>(baseUrl, apiRoutes.order(orderId), auth, options);
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
    { tokenSHA256: auth.tokenSHA256 },
    { timeoutProfile: "action", priority: "action", source: "order-action" }
  );
  const order = normalizeOrderDto(data);
  actionResponseCompleteness.set(order, hasCompleteActionSnapshot(data));
  return order;
}

export function isCompleteOrderActionResponse(order: OrderDto): boolean {
  return actionResponseCompleteness.get(order) ?? true;
}

export function compactPayload(payload: SubmitOrderActionPayload): SubmitOrderActionPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as SubmitOrderActionPayload;
}

function hasCompleteActionSnapshot(data: OrderApiResponse): boolean {
  return data.status !== undefined && data.status !== null
    && data.is_maker !== undefined && data.is_maker !== null;
}
