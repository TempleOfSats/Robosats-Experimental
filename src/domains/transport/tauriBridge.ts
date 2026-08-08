import type { AndroidNotificationState, AndroidTorDiagnostics } from "@/domains/transport/androidBridge";

type DesktopRuntimeStatus = {
  state: "starting" | "connecting" | "ready" | "failed" | "loading";
  connected: boolean;
  progress: number;
  message: string;
  error?: string | null;
  socksPort: number;
  artiVersion?: string | null;
  restartCount: number;
};

type DesktopNotificationState = {
  supported: boolean;
  enabled: boolean;
  permission: string;
};

export type DesktopTransportDiagnostic = {
  phase: "bootstrap" | "tor-connect" | "stream" | "socks" | "unknown";
  outcome: "ready" | "completed" | "timeout" | "circuit-failed" | "stream-closed" | "rejected" | "failed" | "unknown";
  durationMs: number;
  attempt: number;
  artiVersion: string;
};

export const DESKTOP_NOTIFICATION_OPEN_EVENT = "robosats:desktop-notification-open";

let pendingDesktopNotificationRoute: string | undefined;
let desktopNotificationsEnabled = false;

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && window.RobosatsSettings?.startsWith("desktop-") === true;
}

export async function getDesktopTorDiagnostics(): Promise<AndroidTorDiagnostics | null> {
  if (!isTauriDesktop()) return null;
  const [status, appVersion] = await Promise.all([
    invoke<DesktopRuntimeStatus>("desktop_runtime_status"),
    getDesktopAppVersion()
  ]);
  return {
    connected: status.connected,
    state: status.connected ? "connected" : status.state === "failed" ? "failed" : "connecting",
    socksHost: "127.0.0.1",
    socksPort: status.socksPort,
    implementation: "Embedded Arti",
    artiVersion: status.artiVersion ?? "Starting",
    bootstrapProgress: status.progress,
    clientInitialized: status.state !== "starting",
    proxyRunning: status.connected,
    networkAvailable: navigator.onLine,
    routing: "System webview through app-scoped SOCKS5",
    appVersion,
    error: status.error ?? null
  };
}

export async function getDesktopNotificationState(): Promise<AndroidNotificationState | null> {
  if (!isTauriDesktop()) return null;
  const state = await invoke<DesktopNotificationState>("desktop_notification_state");
  desktopNotificationsEnabled = state.enabled && state.permission === "granted";
  return {
    enabled: state.enabled,
    permissionGranted: state.supported && state.permission === "granted",
    permissionRequired: false
  };
}

export async function setDesktopNotificationsEnabled(enabled: boolean): Promise<void> {
  if (!isTauriDesktop()) return;
  const state = await invoke<DesktopNotificationState>("desktop_set_notifications_enabled", { enabled });
  desktopNotificationsEnabled = state.enabled && state.permission === "granted";
}

export async function showDesktopNotification(request: {
  title: string;
  body: string;
  route?: string;
  avatar?: { cacheKey: string; dataUrl: string };
}): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  return invoke<boolean>("desktop_show_notification", { request });
}

export async function requestDesktopTransportRecovery(): Promise<void> {
  if (!isTauriDesktop()) return;
  await invoke("desktop_recover_transport");
}

export async function requestDesktopTorReconnect(): Promise<void> {
  if (!isTauriDesktop()) return;
  await invoke("desktop_reconnect_transport");
}

export async function requestDesktopTorReset(): Promise<void> {
  if (!isTauriDesktop()) return;
  await invoke("desktop_reset_transport");
}

export async function saveDesktopFile(filename: string, content: string): Promise<void> {
  if (!isTauriDesktop()) return;
  await invoke("desktop_save_file", { filename, content });
}

export async function getDesktopTransportDiagnostics(): Promise<DesktopTransportDiagnostic[]> {
  if (!isTauriDesktop()) return [];
  return invoke<DesktopTransportDiagnostic[]>("desktop_transport_diagnostics");
}

export async function loadDesktopSecret(key: string): Promise<string | null> {
  if (!isTauriDesktop()) return null;
  return invoke<string | null>("desktop_secret_get", { key });
}

export async function saveDesktopSecret(key: string, value: string): Promise<void> {
  if (!isTauriDesktop()) return;
  await invoke("desktop_secret_set", { key, value });
}

export async function removeDesktopSecret(key: string): Promise<void> {
  if (!isTauriDesktop()) return;
  await invoke("desktop_secret_delete", { key });
}

export function initializeDesktopRuntimeBridge(): void {
  if (!isTauriDesktop()) return;

  const forwardStatus = (payload: unknown) => {
    window.dispatchEvent(new CustomEvent("robosats:desktop-runtime-state", { detail: payload }));
  };
  void listen("desktop-runtime-status", forwardStatus);
  void listen("desktop-notification-state", (payload) => {
    if (isDesktopNotificationState(payload)) {
      desktopNotificationsEnabled = payload.enabled && payload.permission === "granted";
    }
    window.dispatchEvent(new CustomEvent("robosats:native-notification-state", { detail: payload }));
  });
  void listen("desktop-notification-open", publishDesktopNotificationRoute).then(async () => {
    const route = await invoke<string | null>("desktop_take_notification_route");
    if (route) publishDesktopNotificationRoute(route);
  });
  void getDesktopNotificationState().catch(() => null);
  void listen("robosats:tor-reconnected", (payload) => {
    window.dispatchEvent(new CustomEvent("robosats:tor-reconnected", { detail: payload }));
    window.dispatchEvent(new CustomEvent("robosats:tor-ready", { detail: payload }));
  });
  void listen("robosats:native-resume", () => {
    window.dispatchEvent(new Event("robosats:native-resume"));
  });

  window.addEventListener("robosats:boot-stage", (event) => {
    const detail = (event as CustomEvent<{ progress?: number; message?: string }>).detail;
    void invoke("desktop_boot_stage", {
      progress: Math.max(1, Math.min(99, Number(detail?.progress) || 82)),
      message: detail?.message || "Starting the private interface..."
    });
  });
  window.addEventListener("robosats:app-ready", () => {
    void invoke("desktop_app_ready");
  });
  window.addEventListener("online", () => {
    void invoke("desktop_network_changed", { online: true });
  });
  window.addEventListener("offline", () => {
    void invoke("desktop_network_changed", { online: false });
  });
  document.addEventListener("click", (event) => {
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target !== "_blank") return;
    event.preventDefault();
    void invoke("desktop_open_external", { url: anchor.href });
  });
}

export function takePendingDesktopNotificationRoute(): string | undefined {
  const route = pendingDesktopNotificationRoute;
  pendingDesktopNotificationRoute = undefined;
  return route;
}

export function desktopBackgroundNotificationsEnabled(): boolean {
  return isTauriDesktop() && desktopNotificationsEnabled;
}

function publishDesktopNotificationRoute(payload: unknown): void {
  if (typeof payload !== "string" || !validOrderRoute(payload)) return;
  pendingDesktopNotificationRoute = payload;
  window.dispatchEvent(new CustomEvent(DESKTOP_NOTIFICATION_OPEN_EVENT, { detail: payload }));
}

function validOrderRoute(route: string): boolean {
  return /^\/order\/[a-z0-9-]+\/[1-9]\d*$/i.test(route);
}

function isDesktopNotificationState(value: unknown): value is DesktopNotificationState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<DesktopNotificationState>;
  return typeof state.enabled === "boolean" && typeof state.permission === "string";
}

async function invoke<T = void>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

async function getDesktopAppVersion(): Promise<string> {
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

async function listen(event: string, callback: (payload: unknown) => void): Promise<void> {
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  await tauriListen(event, ({ payload }) => callback(payload));
}
