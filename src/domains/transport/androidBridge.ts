export type NativeHttpResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

type PendingRequest = {
  resolve: (value: NativeHttpResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingRequests = new Map<string, PendingRequest>();
const sockets = new Map<string, NativeWebSocket>();

export function isAndroidApp(): boolean {
  return typeof window !== "undefined" && typeof window.AndroidAppRobosats?.httpRequest === "function";
}

export function isIOSApp(): boolean {
  return typeof window !== "undefined" && typeof window.IOSAppRobosats?.httpRequest === "function";
}

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && typeof window.RoboSatsDesktop?.getTorDiagnostics === "function";
}

export function isNativeApp(): boolean {
  return nativeAppBridge() !== undefined;
}

export type NativeNotificationState = {
  enabled: boolean;
  permissionGranted: boolean;
  permissionRequired: boolean;
};

export type NativeTorDiagnostics = {
  connected: boolean;
  state: "connected" | "connecting" | "failed" | "off";
  socksHost: string | null;
  socksPort: number | null;
  implementation: string;
  artiVersion: string;
  bootstrapProgress: number;
  clientInitialized: boolean;
  proxyRunning: boolean;
  networkAvailable: boolean;
  routing: string;
  appVersion: string;
  error: string | null;
};

export function getNativeNotificationState(): NativeNotificationState | null {
  const raw = runtimeBridge()?.getNotificationState?.();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NativeNotificationState;
  } catch {
    return null;
  }
}

export function setNativeNotificationsEnabled(enabled: boolean): void {
  runtimeBridge()?.setNotificationsEnabled?.(enabled);
}

export function getNativeTorDiagnostics(): NativeTorDiagnostics | null {
  const raw = runtimeBridge()?.getTorDiagnostics?.();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NativeTorDiagnostics;
  } catch {
    return null;
  }
}

export function nativeHttpRequest(
  url: string,
  init: RequestInit = {},
  timeoutMs = 90_000
): Promise<NativeHttpResult> {
  const bridge = nativeAppBridge();
  if (!bridge) return Promise.reject(new Error("Native transport is unavailable"));

  const requestId = createId("http");
  const headers = headersToRecord(init.headers);
  const body = typeof init.body === "string" ? init.body : "";
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Tor request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    pendingRequests.set(requestId, { resolve, reject, timeout });
    try {
      bridge.httpRequest(requestId, init.method ?? "GET", url, JSON.stringify(headers), body);
    } catch (error) {
      globalThis.clearTimeout(timeout);
      pendingRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error("Could not start Tor request"));
    }
  });
}

export async function transportRequest(
  url: string,
  init: RequestInit = {},
  timeoutMs = 90_000
): Promise<NativeHttpResult> {
  if (isNativeApp()) return nativeHttpRequest(url, init, timeoutMs);

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text()
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function webSocketImplementation(): typeof WebSocket {
  return (isNativeApp() ? NativeWebSocket : WebSocket) as typeof WebSocket;
}

export function createWebSocket(url: string, protocols?: string | string[]): WebSocket {
  const Constructor = webSocketImplementation();
  return protocols === undefined ? new Constructor(url) : new Constructor(url, protocols);
}

export class NativeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly url: string;
  readonly extensions = "";
  protocol = "";
  readyState = NativeWebSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType: BinaryType = "blob";
  onopen: ((this: WebSocket, event: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, event: Event) => unknown) | null = null;
  onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null;

  private readonly socketId = createId("ws");

  constructor(url: string | URL, protocols: string | string[] = []) {
    super();
    this.url = String(url);
    const normalizedProtocols = typeof protocols === "string" ? [protocols] : protocols;
    const bridge = nativeAppBridge();
    if (!bridge) throw new DOMException("Native transport is unavailable", "NetworkError");
    sockets.set(this.socketId, this);
    bridge.openWebSocket(this.socketId, this.url, JSON.stringify(normalizedProtocols));
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState === NativeWebSocket.CONNECTING) {
      throw new DOMException("WebSocket is not open", "InvalidStateError");
    }
    // Browsers silently discard frames once a socket starts closing. Nostr
    // subscriptions can race cleanup with a final send, so match that behavior.
    if (this.readyState !== NativeWebSocket.OPEN) return;
    if (typeof data !== "string") throw new DOMException("Binary frames are not supported", "NotSupportedError");
    if (!nativeAppBridge()?.sendWebSocket(this.socketId, data)) {
      throw new DOMException("WebSocket send failed", "NetworkError");
    }
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState >= NativeWebSocket.CLOSING) return;
    this.readyState = NativeWebSocket.CLOSING;
    nativeAppBridge()?.closeWebSocket(this.socketId, code, reason);
  }

  nativeOpen(protocol: string): void {
    if (this.readyState !== NativeWebSocket.CONNECTING) return;
    this.protocol = protocol;
    this.readyState = NativeWebSocket.OPEN;
    this.emit(new Event("open"), this.onopen);
  }

  nativeMessage(data: string): void {
    if (this.readyState !== NativeWebSocket.OPEN) return;
    this.emit(new MessageEvent("message", { data, origin: this.url }), this.onmessage);
  }

  nativeClosing(): void {
    if (this.readyState < NativeWebSocket.CLOSING) this.readyState = NativeWebSocket.CLOSING;
  }

  nativeClosed(code: number, reason: string): void {
    this.readyState = NativeWebSocket.CLOSED;
    sockets.delete(this.socketId);
    this.emit(new CloseEvent("close", { code, reason, wasClean: code === 1000 }), this.onclose);
  }

  nativeError(message: string): void {
    this.emit(new ErrorEvent("error", { message }), this.onerror);
    if (this.readyState !== NativeWebSocket.CLOSED) this.nativeClosed(1006, message);
  }

  private emit<T extends Event>(event: T, handler: ((this: WebSocket, event: T) => unknown) | null): void {
    this.dispatchEvent(event);
    handler?.call(this as unknown as WebSocket, event);
  }
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  return headers ? Object.fromEntries(new Headers(headers).entries()) : {};
}

export function nativeAppBridge(): RoboSatsNativeBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AndroidAppRobosats ?? window.IOSAppRobosats;
}

function runtimeBridge(): Pick<
  RoboSatsNativeBridge,
  "getNotificationState" | "getTorDiagnostics" | "setNotificationsEnabled"
> | RoboSatsDesktopBridge | undefined {
  return nativeAppBridge() ?? (typeof window === "undefined" ? undefined : window.RoboSatsDesktop);
}

export type AndroidNotificationState = NativeNotificationState;
export type AndroidTorDiagnostics = NativeTorDiagnostics;
export const getAndroidNotificationState = getNativeNotificationState;
export const setAndroidNotificationsEnabled = setNativeNotificationsEnabled;
export const getAndroidTorDiagnostics = getNativeTorDiagnostics;

if (typeof window !== "undefined") {
  window.__robosatsNativeTransport = {
    resolve(requestId, result) {
      const pending = pendingRequests.get(requestId);
      if (!pending) return;
      globalThis.clearTimeout(pending.timeout);
      pendingRequests.delete(requestId);
      pending.resolve(result);
    },
    reject(requestId, message) {
      const pending = pendingRequests.get(requestId);
      if (!pending) return;
      globalThis.clearTimeout(pending.timeout);
      pendingRequests.delete(requestId);
      pending.reject(new Error(message));
    },
    webSocketOpen(socketId, protocol) {
      sockets.get(socketId)?.nativeOpen(protocol);
    },
    webSocketMessage(socketId, message) {
      sockets.get(socketId)?.nativeMessage(message);
    },
    webSocketClosing(socketId) {
      sockets.get(socketId)?.nativeClosing();
    },
    webSocketClosed(socketId, code, reason) {
      sockets.get(socketId)?.nativeClosed(code, reason);
    },
    webSocketError(socketId, message) {
      sockets.get(socketId)?.nativeError(message);
    }
  };
}
