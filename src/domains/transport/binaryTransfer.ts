import { base64 } from "@scure/base";
import { isNativeApp, nativeHttpRequest } from "@/domains/transport/androidBridge";
import { requestCoordinator } from "@/domains/transport/apiWebClient";
import { ApiResponseValidationError } from "@/domains/transport/apiError";

export const MAX_BINARY_BYTES = 10 * 1024 * 1024 + 16;

export async function transferBinary(
  baseUrl: string,
  path: string,
  signal: AbortSignal,
  upload?: { bytes: Uint8Array; authorization: string }
): Promise<Uint8Array> {
  if (upload && upload.bytes.length > MAX_BINARY_BYTES) throw new Error("Image is too large.");
  return requestCoordinator<Uint8Array>(
    baseUrl,
    path,
    {
      method: upload ? "PUT" : "GET",
      headers: upload ? { "Content-Type": "application/octet-stream", Authorization: upload.authorization } : {},
      body: upload?.bytes.slice().buffer
    },
    { signal, timeoutProfile: "action", priority: "foreground", source: "chat" },
    undefined,
    binaryExchange
  );
}

async function binaryExchange(url: string, init: RequestInit = {}, _timeoutMs?: number, signal?: AbortSignal) {
  if (isNativeApp()) {
    const body = init.body instanceof ArrayBuffer ? base64.encode(new Uint8Array(init.body)) : "";
    try {
      const response = await nativeHttpRequest(url, { ...init, body }, 90_000, signal, true);
      if (response.body.length > Math.ceil(MAX_BINARY_BYTES / 3) * 4)
        throw new ApiResponseValidationError("Image is too large.");
      const bytes = base64.decode(response.body);
      if (bytes.length > MAX_BINARY_BYTES) throw new ApiResponseValidationError("Image is too large.");
      return { ...response, body: bytes };
    } catch (error) {
      if (
        error instanceof Error &&
        /^(Image is too large|The Tor response exceeded the safety limit)/.test(error.message)
      ) {
        throw new ApiResponseValidationError("Image is too large.");
      }
      throw error;
    }
  }
  const response = await fetch(url, {
    ...init,
    signal,
    redirect: "error",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store"
  });
  const bytes = await readLimitedBody(response);
  return {
    status: response.status,
    headers: { "content-type": "application/octet-stream" },
    body: bytes
  };
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Image download is unavailable in this browser.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (Number(response.headers.get("content-length")) > MAX_BINARY_BYTES)
      throw new ApiResponseValidationError("Image is too large.");
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BINARY_BYTES) throw new ApiResponseValidationError("Image is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
