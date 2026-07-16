import { apiRoutes, type ApiClient, type Auth } from "@/domains/transport/apiClient";
import { apiClient } from "@/domains/transport/apiWebClient";

export interface RobotApiResponse {
  nickname?: unknown;
  hash_id?: unknown;
  public_key?: unknown;
  encrypted_private_key?: unknown;
  earned_rewards?: unknown;
  wants_stealth?: unknown;
  nostr_pubkey?: unknown;
  active_order_id?: unknown;
  last_order_id?: unknown;
  found?: unknown;
  last_login?: unknown;
  tg_enabled?: unknown;
  tg_bot_name?: unknown;
  tg_token?: unknown;
  webhook_url?: unknown;
  webhook_enabled?: unknown;
  webhook_api_key?: unknown;
  bad_request?: unknown;
}

export interface RobotSnapshot {
  nickname: string;
  hashId: string;
  pubKey?: string;
  encPrivKey?: string;
  earnedRewards: number;
  stealthInvoices: boolean;
  nostrPubKey?: string;
  activeOrderId?: number;
  lastOrderId?: number;
  found: boolean;
  lastLogin?: string;
  tgEnabled: boolean;
  tgBotName?: string;
  tgToken?: string;
  webhookUrl?: string;
  webhookEnabled: boolean;
  webhookApiKey?: string;
  badRequest?: string;
}

export async function fetchRobot(
  baseUrl: string,
  auth: Auth,
  client: ApiClient = apiClient
): Promise<RobotSnapshot> {
  const data = await client.get<RobotApiResponse>(baseUrl, apiRoutes.robot, auth);
  return normalizeRobotResponse(data);
}

export function normalizeRobotResponse(data: RobotApiResponse): RobotSnapshot {
  return {
    nickname: toStringValue(data.nickname),
    hashId: toStringValue(data.hash_id),
    pubKey: toOptionalString(data.public_key),
    encPrivKey: toOptionalString(data.encrypted_private_key),
    earnedRewards: toNumber(data.earned_rewards),
    stealthInvoices: toBoolean(data.wants_stealth, true),
    nostrPubKey: toOptionalString(data.nostr_pubkey),
    activeOrderId: toOptionalPositiveNumber(data.active_order_id),
    lastOrderId: toOptionalPositiveNumber(data.last_order_id),
    found: toBoolean(data.found),
    lastLogin: toOptionalString(data.last_login),
    tgEnabled: toBoolean(data.tg_enabled),
    tgBotName: toOptionalString(data.tg_bot_name),
    tgToken: toOptionalString(data.tg_token),
    webhookUrl: toOptionalString(data.webhook_url),
    webhookEnabled: toBoolean(data.webhook_enabled),
    webhookApiKey: toOptionalString(data.webhook_api_key),
    badRequest: toOptionalString(data.bad_request)
  };
}

export async function updateRobotWebhook(
  baseUrl: string,
  payload: UpdateRobotWebhookPayload,
  auth: Auth,
  client: ApiClient = apiClient
): Promise<UpdateRobotWebhookResult> {
  const data = await client.put<UpdateRobotWebhookApiResponse>(baseUrl, apiRoutes.robot, compactWebhookPayload(payload), auth);
  return {
    webhookUrl: toOptionalString(data.webhook_url),
    webhookEnabled: toBoolean(data.webhook_enabled),
    webhookApiKey: toOptionalString(data.webhook_api_key)
  };
}

export async function updateStealthInvoices(
  baseUrl: string,
  wantsStealth: boolean,
  auth: Auth,
  client: ApiClient = apiClient
): Promise<boolean> {
  const data = await client.post<{ wantsStealth?: unknown }>(
    baseUrl,
    apiRoutes.stealth,
    { wantsStealth },
    auth,
    { timeoutProfile: "action" }
  );
  return toBoolean(data.wantsStealth);
}

export interface UpdateRobotWebhookPayload {
  webhook_url?: string | null;
  webhook_enabled?: boolean;
  webhook_api_key?: string | null;
}

interface UpdateRobotWebhookApiResponse {
  webhook_url?: unknown;
  webhook_enabled?: unknown;
  webhook_api_key?: unknown;
}

export interface UpdateRobotWebhookResult {
  webhookUrl?: string;
  webhookEnabled: boolean;
  webhookApiKey?: string;
}

function compactWebhookPayload(payload: UpdateRobotWebhookPayload): UpdateRobotWebhookPayload {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as UpdateRobotWebhookPayload;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toOptionalPositiveNumber(value: unknown): number | undefined {
  const parsed = toNumber(value);
  return parsed > 0 ? parsed : undefined;
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.trim().toLowerCase() === "true" || value === "1";
  return fallback;
}

function toStringValue(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function toOptionalString(value: unknown): string | undefined {
  const text = toStringValue(value);
  return text ? text : undefined;
}
