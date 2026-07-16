import type { ApiClient, ApiRequestOptions, Auth, TimeoutProfile } from "@/domains/transport/apiClient";
import { buildAuthHeaders } from "@/domains/transport/apiClient";
import { transportRequest } from "@/domains/transport/androidBridge";
import { toUserMessage } from "@/lib/userError";

const inFlightGets = new Map<string, Promise<unknown>>();

class ApiWebClient implements ApiClient {
  async get<T>(baseUrl: string, path: string, auth?: Auth, options?: ApiRequestOptions): Promise<T> {
    const headers = buildAuthHeaders(auth);
    const requestKey = getRequestKey(baseUrl, path, headers, options);
    const inFlight = inFlightGets.get(requestKey);
    if (inFlight) return inFlight as Promise<T>;

    const promise = request<T>(baseUrl, path, { method: "GET", headers }, options).finally(() => {
      inFlightGets.delete(requestKey);
    });
    inFlightGets.set(requestKey, promise);
    return promise;
  }

  async post<T>(baseUrl: string, path: string, body: object, auth?: Auth, options?: ApiRequestOptions): Promise<T> {
    return request<T>(baseUrl, path, {
      method: "POST",
      headers: buildAuthHeaders(auth),
      body: JSON.stringify(body)
    }, options);
  }

  async put<T>(baseUrl: string, path: string, body: object, auth?: Auth, options?: ApiRequestOptions): Promise<T> {
    return request<T>(baseUrl, path, {
      method: "PUT",
      headers: buildAuthHeaders(auth),
      body: JSON.stringify(body)
    }, options);
  }

  async delete<T>(baseUrl: string, path: string, auth?: Auth, options?: ApiRequestOptions): Promise<T> {
    return request<T>(baseUrl, path, { method: "DELETE", headers: buildAuthHeaders(auth) }, options);
  }
}

async function request<T>(baseUrl: string, path: string, init: RequestInit, options: ApiRequestOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? timeoutForProfile(options.timeoutProfile ?? "interactive");
  try {
    const response = await transportRequest(baseUrl + path, init, timeoutMs);
    const contentType = response.headers["content-type"] ?? "";
    const data = contentType.includes("application/json") ? JSON.parse(response.body || "null") : response.body;
    if (response.status < 200 || response.status >= 300) {
      throw new RoboSatsApiError(response.status, data);
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.message.includes("timeout after")) {
      throw new Error("The request took too long. Please try again.");
    }
    throw error;
  }
}

class RoboSatsApiError extends Error {
  constructor(readonly status: number, readonly response: unknown) {
    super(toUserMessage(response, apiStatusFallback(status)));
    this.name = "RoboSatsApiError";
  }
}

function apiStatusFallback(status: number): string {
  if (status === 401 || status === 403) return "The coordinator could not verify this robot.";
  if (status === 404) return "This item is no longer available.";
  if (status >= 500) return "The coordinator is temporarily unavailable. Please try again.";
  return "The coordinator could not complete that request. Please check the details and try again.";
}

function timeoutForProfile(profile: TimeoutProfile): number {
  if (profile === "background") return 20_000;
  if (profile === "action") return 90_000;
  return 45_000;
}

function getRequestKey(baseUrl: string, path: string, headers: HeadersInit, options: ApiRequestOptions = {}): string {
  return JSON.stringify({
    url: baseUrl + path,
    headers: normalizeHeaders(headers),
    timeoutMs: options.timeoutMs,
    timeoutProfile: options.timeoutProfile ?? "interactive"
  });
}

function normalizeHeaders(headers: HeadersInit): Array<[string, string]> {
  if (headers instanceof Headers) {
    return [...headers.entries()].sort(([left], [right]) => left.localeCompare(right));
  }
  if (Array.isArray(headers)) {
    return headers.map(([key, value]) => [key.toLowerCase(), value] as [string, string]).sort(([left], [right]) => left.localeCompare(right));
  }
  return Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value] as [string, string]).sort(([left], [right]) => left.localeCompare(right));
}

export const apiClient = new ApiWebClient();
