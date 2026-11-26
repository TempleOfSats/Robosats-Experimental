import { signRobotAction, type RobotSigningCredentials } from "@/domains/crypto/actionSignature";
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
  signing: RobotSigningCredentials | undefined,
  client: ApiClient = apiClient
): Promise<ReviewToken> {
  const signature = await signRobotAction(`review:${pubkey}`, signing);
  const data = await client.post<ReviewTokenApiResponse>(
    baseUrl,
    apiRoutes.review,
    { pubkey, signature },
    {
      tokenSHA256: auth.tokenSHA256
    }
  );
  return {
    pubkey: toStringValue(data.pubkey),
    token: toStringValue(data.token)
  };
}

function toStringValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}
