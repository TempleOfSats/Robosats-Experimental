import { escapeArmoredKeyForHeader } from "@/domains/crypto/pgpHeaders";

export interface Auth {
  tokenSHA256: string;
  nostrPubkey?: string;
  keys?: {
    pubKey: string;
    encPrivKey: string;
  };
}

export type TimeoutProfile = "interactive" | "background" | "action";

export interface ApiRequestOptions {
  timeoutProfile?: TimeoutProfile;
  timeoutMs?: number;
}

export interface ApiClient {
  get<T>(baseUrl: string, path: string, auth?: Auth, options?: ApiRequestOptions): Promise<T>;
  post<T>(baseUrl: string, path: string, body: object, auth?: Auth, options?: ApiRequestOptions): Promise<T>;
  put<T>(baseUrl: string, path: string, body: object, auth?: Auth, options?: ApiRequestOptions): Promise<T>;
  delete<T>(baseUrl: string, path: string, auth?: Auth, options?: ApiRequestOptions): Promise<T>;
}

export function buildAuthHeaders(auth?: Auth): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (auth && auth.keys === undefined) {
    headers.Authorization = `Token ${auth.tokenSHA256}`;
  } else if (auth?.keys && auth.nostrPubkey) {
    headers.Authorization = `Token ${auth.tokenSHA256} | Public ${escapeArmoredKeyForHeader(auth.keys.pubKey)} | Private ${escapeArmoredKeyForHeader(auth.keys.encPrivKey)} | Nostr ${auth.nostrPubkey}`;
  }

  return headers;
}

export const apiRoutes = {
  info: "/api/info/",
  limits: "/api/limits/",
  book: "/api/book/",
  robot: "/api/robot/",
  make: "/api/make/",
  order: (orderId: number) => `/api/order/?order_id=${orderId}`,
  chat: (orderId: number, offset: number) => `/api/chat/?order_id=${orderId}&offset=${offset}`,
  chatPost: "/api/chat/",
  reward: "/api/reward/",
  stealth: "/api/stealth/",
  review: "/api/review/"
} as const;
