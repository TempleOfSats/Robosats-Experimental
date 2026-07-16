import { apiRoutes, type ApiClient, type Auth } from "@/domains/transport/apiClient";
import { apiClient } from "@/domains/transport/apiWebClient";
import type { ChatApiMessage, ChatApiResponse, ChatMessage, ChatResponse } from "@/domains/chat/chat.types";

export async function fetchChatMessages(
  baseUrl: string,
  orderId: number,
  offset: number,
  auth: Auth,
  client: ApiClient = apiClient
): Promise<ChatResponse> {
  const data = await client.get<ChatApiResponse>(baseUrl, apiRoutes.chat(orderId, offset), auth);
  return normalizeChatResponse(data);
}

export async function postChatMessage(
  baseUrl: string,
  orderId: number,
  encryptedMessage: string,
  offset: number,
  auth: Auth,
  client: ApiClient = apiClient
): Promise<ChatResponse> {
  const data = await client.post<ChatApiResponse>(
    baseUrl,
    apiRoutes.chatPost,
    {
      order_id: orderId,
      PGP_message: escapeChatPayload(encryptedMessage),
      offset
    },
    auth
  );
  return normalizeChatResponse(data);
}

export function normalizeChatResponse(data: ChatApiResponse): ChatResponse {
  const messages = Array.isArray(data.messages) ? data.messages : [];
  return {
    peerConnected: toBoolean(data.peer_connected),
    peerPubkey: restoreSeparator(data.peer_pubkey),
    messages: messages.map((message) => normalizeChatMessage(message as ChatApiMessage)).filter((message) => message.encryptedMessage)
  };
}

export function normalizeChatMessage(data: ChatApiMessage): ChatMessage {
  const encryptedMessage = restorePgpMessage(data.message ?? data.PGP_message);
  return {
    index: toNumber(data.index),
    time: toStringValue(data.time ?? data.created_at),
    encryptedMessage,
    nick: toStringValue(data.nick ?? data.user_nick ?? data.sender)
  };
}

export function escapeChatPayload(value: string): string {
  if (value.startsWith("#")) return value;
  return value.split("\n").join("\\");
}

function restorePgpMessage(value: unknown): string {
  const text = toStringValue(value);
  if (!text.startsWith("-----BEGIN PGP")) return text;
  return restoreSeparator(text);
}

function restoreSeparator(value: unknown): string {
  return toStringValue(value).split("\\").join("\n");
}

function toStringValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}
