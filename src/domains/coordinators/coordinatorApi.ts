import { apiRoutes } from "@/domains/transport/apiClient";
import { apiClient } from "@/domains/transport/apiWebClient";
import type { CoordinatorInfo, CoordinatorLimitList } from "@/domains/coordinators/coordinator.types";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { normalizePublicOrder, type PublicOrderApi } from "@/domains/orderbook/orderbookModel";

export async function fetchCoordinatorInfo(
  baseUrl: string,
  options: { force?: boolean; priority?: "background" | "visible" } = {}
): Promise<CoordinatorInfo> {
  const visible = options.force || options.priority === "visible";
  return apiClient.get<CoordinatorInfo>(baseUrl, apiRoutes.info, undefined, {
    bypassCircuit: options.force,
    timeoutProfile: visible ? "interactive" : "background",
    priority: visible ? "visible" : "maintenance",
    source: options.force ? "manual" : "federation"
  });
}

export async function fetchCoordinatorLimits(
  baseUrl: string,
  options: { force?: boolean; priority?: "background" | "visible" } = {}
): Promise<CoordinatorLimitList> {
  const visible = options.force || options.priority === "visible";
  return apiClient.get<CoordinatorLimitList>(baseUrl, apiRoutes.limits, undefined, {
    bypassCircuit: options.force,
    timeoutProfile: visible ? "interactive" : "background",
    priority: visible ? "visible" : "maintenance",
    source: options.force ? "manual" : "federation"
  });
}

export async function fetchCoordinatorBook(
  baseUrl: string,
  options: { force?: boolean; priority?: "background" | "visible" } = {}
): Promise<PublicOrder[]> {
  const visible = options.force || options.priority !== "background";
  const data = await apiClient.get<PublicOrderApi[] | { orders?: PublicOrderApi[] }>(baseUrl, apiRoutes.book, undefined, {
    bypassCircuit: options.force,
    timeoutProfile: visible ? "interactive" : "background",
    priority: visible ? "visible" : "background",
    source: options.force ? "manual" : visible ? "orderbook-fallback" : "prewarm"
  });
  const orders = Array.isArray(data) ? data : data.orders ?? [];
  return orders.map(normalizePublicOrder);
}
