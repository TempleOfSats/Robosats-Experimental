export interface ChatApiMessage {
  index?: unknown;
  time?: unknown;
  created_at?: unknown;
  message?: unknown;
  PGP_message?: unknown;
  nick?: unknown;
  user_nick?: unknown;
  sender?: unknown;
}

export interface ChatApiResponse {
  peer_connected?: unknown;
  peer_pubkey?: unknown;
  messages?: unknown;
}

export interface ChatMessage {
  index: number;
  time: string;
  encryptedMessage: string;
  nick: string;
}

export interface ChatResponse {
  peerConnected: boolean;
  peerPubkey: string;
  messages: ChatMessage[];
}

export interface DisplayChatMessage extends ChatMessage {
  plaintext: string;
  mine: boolean;
  decryptFailed: boolean;
}
