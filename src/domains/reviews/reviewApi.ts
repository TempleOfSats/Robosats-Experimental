import { apiRoutes, type ApiClient, type Auth } from "@/domains/transport/apiClient";
import { apiClient } from "@/domains/transport/apiWebClient";

interface ReviewTokenApiResponse {
  pubkey?: unknown;
  token?: unknown;
}

export interface ReviewToken {
  pubkey: string;
  token: string;
}

export async function requestReviewToken(
  baseUrl: string,
  pubkey: string,
  auth: Auth,
  client: ApiClient = apiClient
): Promise<ReviewToken> {
  const data = await client.post<ReviewTokenApiResponse>(baseUrl, apiRoutes.review, { pubkey }, auth);
  return {
    pubkey: toStringValue(data.pubkey),
    token: toStringValue(data.token)
  };
}

function toStringValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}
