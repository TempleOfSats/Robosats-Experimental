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

export type RequestPriority = "action" | "foreground" | "visible" | "background" | "maintenance";

export type RequestSource =
  | "order-action"
  | "order-refresh"
  | "chat"
  | "robot-refresh"
  | "federation"
  | "orderbook-fallback"
  | "fleet-reconcile"
  | "prewarm"
  | "statistics"
  | "manual";

export interface ApiRequestOptions {
  bypassCircuit?: boolean;
  timeoutProfile?: TimeoutProfile;
  timeoutMs?: number;
  priority?: RequestPriority;
  source?: RequestSource;
  signal?: AbortSignal;
}

export interface ApiClient {
  get<T>(baseUrl: string, path: string, auth?: Auth, options?: ApiRequestOptions): Promise<T>;
  post<T>(baseUrl: string, path: string, body: object, auth?: Auth, options?: ApiRequestOptions): Promise<T>;
  put<T>(baseUrl: string, path: string, body: object, auth?: Auth, options?: ApiRequestOptions): Promise<T>;
  delete<T>(baseUrl: string, path: string, auth?: Auth, options?: ApiRequestOptions): Promise<T>;
}

export function buildAuthHeaders(auth?: Auth): HeadersInit {
  const headers: Record<string, string> = {};

  if (auth && auth.keys === undefined) {
    headers.Authorization = `Token ${auth.tokenSHA256}`;
  } else if (auth?.keys && auth.nostrPubkey) {
    headers.Authorization = `Token ${auth.tokenSHA256} | Public ${escapeArmoredKeyForHeader(auth.keys.pubKey)} | Private ${escapeArmoredKeyForHeader(auth.keys.encPrivKey)} | Nostr ${auth.nostrPubkey}`;
  }

  return headers;
}

export function buildJsonHeaders(auth?: Auth): HeadersInit {
  return {
    ...buildAuthHeaders(auth),
    "Content-Type": "application/json"
  };
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
  review: "/api/review/",
  historical: "/api/historical/",
  ticks: (start: string, end: string) => `/api/ticks/?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
} as const;
