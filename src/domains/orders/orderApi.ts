import { apiRoutes, type ApiRequestOptions, type Auth, type ApiClient } from "@/domains/transport/apiClient";
import { apiClient } from "@/domains/transport/apiWebClient";
import { normalizeOrderDto, type OrderApiResponse } from "@/domains/orders/orderModel";
import { signRobotAction, type RobotSigningCredentials } from "@/domains/crypto/actionSignature";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { OrderDto, SubmitOrderActionPayload } from "@/domains/orders/order.types";

export const MAX_DISPUTE_STATEMENT_LENGTH = 50_000;

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
  coordinator: Pick<CoordinatorSummary, "url" | "shortAlias">,
  orderId: number,
  payload: SubmitOrderActionPayload,
  auth: Auth,
  signing: RobotSigningCredentials | undefined,
  client: ApiClient = apiClient
): Promise<OrderDto> {
  const body = compactPayload(payload);
  if (payload.action === "submit_statement") {
    body.statement = await signDisputeStatement(payload.statement, signing);
  } else if (payload.action === "update_invoice" && body.invoice) {
    body.invoice = await signRobotAction(body.invoice, signing);
  } else if (payload.action === "update_address" && body.address) {
    body.address = await signRobotAction(body.address, signing);
  }
  const signature = await signRobotAction(`${payload.action}:${orderId}:${coordinator.shortAlias}`, signing);
  const data = await client.post<OrderApiResponse>(
    coordinator.url,
    apiRoutes.order(orderId),
    { ...body, signature },
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

async function signDisputeStatement(
  statement: string | undefined,
  signing: RobotSigningCredentials | undefined
): Promise<string> {
  const text = statement?.trim();
  if (!text) throw new Error("Enter a dispute statement before submitting.");
  if (Array.from(text).length > MAX_DISPUTE_STATEMENT_LENGTH) {
    throw new Error(
      "The statement and attached logs exceed 50,000 characters. Shorten it or submit without chat logs."
    );
  }
  return signRobotAction(text, signing);
}

function hasCompleteActionSnapshot(data: OrderApiResponse): boolean {
  const required: Array<keyof OrderDto> = [
    "status",
    "type",
    "amount",
    "currency",
    "payment_method",
    "premium",
    "satoshis",
    "is_maker",
    "is_taker",
    "is_buyer",
    "is_seller",
    "expires_at"
  ];
  return required.every((field) => data[field] !== undefined);
}
