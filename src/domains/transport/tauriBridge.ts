import type {
  AndroidNotificationState,
  AndroidTorDiagnostics
} from "@/domains/transport/androidBridge";

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

export function isTauriDesktop(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.desktopApp === "true";
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
  return {
    enabled: state.enabled,
    permissionGranted: state.supported,
    permissionRequired: false
  };
}

export async function setDesktopNotificationsEnabled(enabled: boolean): Promise<void> {
  if (!isTauriDesktop()) return;
  await invoke("desktop_set_notifications_enabled", { enabled });
}

export async function showDesktopNotification(request: {
  title: string;
  body: string;
  route?: string;
}): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  return invoke<boolean>("desktop_show_notification", { request });
}

export async function retryDesktopTor(): Promise<void> {
  if (!isTauriDesktop()) return;
  await invoke("desktop_retry");
}

export function initializeDesktopRuntimeBridge(): void {
  if (!isTauriDesktop()) return;

  const forwardStatus = (payload: unknown) => {
    window.dispatchEvent(new CustomEvent("robosats:desktop-runtime-state", { detail: payload }));
  };
  void listen("desktop-runtime-status", forwardStatus);
  void listen("desktop-notification-state", (payload) => {
    window.dispatchEvent(new CustomEvent("robosats:native-notification-state", { detail: payload }));
  });
  void listen("robosats:tor-reconnected", (payload) => {
    window.dispatchEvent(new CustomEvent("robosats:tor-reconnected", { detail: payload }));
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
