import { apiRoutes, type ApiClient, type Auth } from "@/domains/transport/apiClient";
import { apiClient } from "@/domains/transport/apiWebClient";

export interface ClaimRewardApiResponse {
  successful_withdrawal?: unknown;
  bad_invoice?: unknown;
  bad_request?: unknown;
}

export interface ClaimRewardResult {
  successfulWithdrawal: boolean;
  error?: string;
}

export async function claimReward(
  baseUrl: string,
  signedInvoice: string,
  routingBudgetPpm: number,
  auth: Auth,
  client: ApiClient = apiClient
): Promise<ClaimRewardResult> {
  const data = await client.post<ClaimRewardApiResponse>(
    baseUrl,
    apiRoutes.reward,
    routingBudgetPpm > 0
      ? { invoice: signedInvoice, routing_budget_ppm: routingBudgetPpm }
      : { invoice: signedInvoice },
    auth
  );
  return normalizeClaimRewardResponse(data);
}

export function normalizeClaimRewardResponse(data: ClaimRewardApiResponse): ClaimRewardResult {
  return {
    successfulWithdrawal: data.successful_withdrawal === true || data.successful_withdrawal === "true",
    error: firstText(data.bad_invoice, data.bad_request)
  };
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object") return JSON.stringify(value);
  }
  return undefined;
}
