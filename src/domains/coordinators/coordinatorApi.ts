import { apiRoutes } from "@/domains/transport/apiClient";
import { apiClient } from "@/domains/transport/apiWebClient";
import type { CoordinatorInfo, CoordinatorLimitList } from "@/domains/coordinators/coordinator.types";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { normalizePublicOrder, type PublicOrderApi } from "@/domains/orderbook/orderbookModel";

export async function fetchCoordinatorInfo(
  baseUrl: string,
  options: { force?: boolean } = {}
): Promise<CoordinatorInfo> {
  return apiClient.get<CoordinatorInfo>(baseUrl, apiRoutes.info, undefined, {
    bypassCircuit: options.force,
    timeoutProfile: options.force ? "interactive" : "background",
    priority: options.force ? "visible" : "maintenance",
    source: options.force ? "manual" : "federation"
  });
}

export async function fetchCoordinatorLimits(
  baseUrl: string,
  options: { force?: boolean } = {}
): Promise<CoordinatorLimitList> {
  return apiClient.get<CoordinatorLimitList>(baseUrl, apiRoutes.limits, undefined, {
    bypassCircuit: options.force,
    timeoutProfile: options.force ? "interactive" : "background",
    priority: options.force ? "visible" : "maintenance",
    source: options.force ? "manual" : "federation"
  });
}

export async function fetchCoordinatorBook(baseUrl: string): Promise<PublicOrder[]> {
  const data = await apiClient.get<PublicOrderApi[] | { orders?: PublicOrderApi[] }>(baseUrl, apiRoutes.book, undefined, {
    timeoutProfile: "interactive",
    priority: "visible",
    source: "orderbook-fallback"
  });
  const orders = Array.isArray(data) ? data : data.orders ?? [];
  return orders.map(normalizePublicOrder);
}
