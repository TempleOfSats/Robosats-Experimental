export type ChatImageMetadata = {
  type: "image";
  url: string;
  key: string;
  nonce: string;
  sha256: string;
  originalSha256?: string;
  mimeType: string;
};

export const CHAT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;

export function isChatImageMessage(text: string): boolean {
  return /^\s*\{\s*"type"\s*:\s*"image"/.test(text);
}

export function parseChatImage(text: string): ChatImageMetadata | undefined {
  if (!isChatImageMessage(text) || text.length > 4096) return undefined;
  try {
    const value = JSON.parse(text) as ChatImageMetadata;
    const url = new URL(value.url);
    if (
      !CHAT_IMAGE_TYPES.includes(value.mimeType) ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      (value.originalSha256 !== undefined && !/^[a-f0-9]{64}$/.test(value.originalSha256)) ||
      !/^[A-Za-z0-9+/]{43}=$/.test(value.key) ||
      !/^[A-Za-z0-9+/]{32}$/.test(value.nonce) ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== `/blossom/${value.sha256}`
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}
