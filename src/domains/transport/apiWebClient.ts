import type { ApiClient, ApiRequestOptions, Auth, RequestPriority, TimeoutProfile } from "@/domains/transport/apiClient";
import { buildAuthHeaders } from "@/domains/transport/apiClient";
import { recordNetworkPerformance, type NetworkOutcome } from "@/domains/diagnostics/networkPerformance";
import { transportRequest } from "@/domains/transport/androidBridge";
import { RoboSatsApiError } from "@/domains/transport/apiError";
import {
  CoordinatorRequestDeferredError,
  coordinatorRequestScheduler
} from "@/domains/transport/requestScheduler";
import {
  noteTransportFailure,
  noteTransportReachable,
  type TransportFailureCategory
} from "@/domains/transport/transportHealth";

class ApiWebClient implements ApiClient {
  async get<T>(baseUrl: string, path: string, auth?: Auth, options?: ApiRequestOptions): Promise<T> {
    const headers = buildAuthHeaders(auth);
    const requestKey = getRequestKey(baseUrl, path, headers);
    return request<T>(baseUrl, path, { method: "GET", headers }, options, requestKey);
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

async function request<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
  options: ApiRequestOptions = {},
  requestKey?: string
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? timeoutForProfile(options.timeoutProfile ?? "interactive");
  const method = init.method ?? "GET";
  const priority = options.priority ?? defaultPriority(method, options.timeoutProfile);
  const source = options.source ?? defaultSource(method);
  const origin = requestOrigin(baseUrl);
  const queuedAt = now();
  const scheduled = coordinatorRequestScheduler.schedule<T>({
    bypassCircuit: options.bypassCircuit,
    key: requestKey,
    origin,
    method,
    priority,
    source,
    signal: options.signal,
    timeoutMs
  }, async (signal) => {
    const transportStartedAt = now();
    let outcome: NetworkOutcome = "success";
    try {
      // The scheduler owns the adjustable caller timeout. Keep a hard transport
      // ceiling in case a native bridge fails to honor cancellation.
      const response = await transportRequest(baseUrl + path, init, 90_000, signal);
      noteTransportReachable(baseUrl);
      coordinatorRequestScheduler.noteOriginReachable(origin);
      const contentType = response.headers["content-type"] ?? "";
      const data = contentType.includes("application/json") ? JSON.parse(response.body || "null") : response.body;
      if (response.status < 200 || response.status >= 300) {
        outcome = "http-error";
        throw new RoboSatsApiError(response.status, data, apiStatusFallback(response.status));
      }
      return data as T;
    } catch (error) {
      outcome = classifyOutcome(error);
      if (
        !(error instanceof RoboSatsApiError)
        && !(error instanceof CoordinatorRequestDeferredError)
        && outcome !== "cancelled"
      ) {
        noteTransportFailure(baseUrl, failureCategory(error));
        coordinatorRequestScheduler.noteOriginFailure(origin);
      }
      if (error instanceof Error && error.message.includes("timeout after")) {
        throw new Error("The request took too long. Please try again.");
      }
      throw error;
    } finally {
      const completedAt = now();
      recordNetworkPerformance({
        origin,
        source,
        priority,
        queuedMs: Math.max(0, transportStartedAt - queuedAt),
        transportMs: Math.max(0, completedAt - transportStartedAt),
        totalMs: Math.max(0, completedAt - queuedAt),
        outcome
      });
    }
  });
  return scheduled.promise;
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

function defaultPriority(method: string, profile: TimeoutProfile = "interactive"): RequestPriority {
  if (method.toUpperCase() !== "GET") return "action";
  if (profile === "action") return "foreground";
  if (profile === "background") return "background";
  return "visible";
}

function defaultSource(method: string): NonNullable<ApiRequestOptions["source"]> {
  return method.toUpperCase() === "GET" ? "manual" : "order-action";
}

function requestOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

function classifyOutcome(error: unknown): NetworkOutcome {
  if (error instanceof RoboSatsApiError) return "http-error";
  if (error instanceof CoordinatorRequestDeferredError) return "cancelled";
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  if (error instanceof Error && /timeout/i.test(error.message)) return "timeout";
  return "network-error";
}

function failureCategory(error: unknown): TransportFailureCategory {
  if (error instanceof Error && /timeout/i.test(error.message)) return "timeout";
  if (error instanceof Error && /socket|websocket/i.test(error.message)) return "socket";
  return "connect";
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function getRequestKey(baseUrl: string, path: string, headers: HeadersInit): string {
  return JSON.stringify({
    url: baseUrl + path,
    headers: normalizeHeaders(headers)
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
