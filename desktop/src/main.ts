import {
  app,
  BrowserWindow,
  ipcMain,
  net as electronNet,
  Notification,
  powerMonitor,
  protocol,
  session,
  shell
} from "electron";
import { createConnection } from "node:net";
import path from "node:path";
import { ArtiProcess, type ArtiProgress } from "./artiProcess";
import { registerAppProtocol } from "./appProtocol";
import {
  normalizeNotificationPayload,
  readRuntimePreferences,
  writeRuntimePreferences,
  type RuntimePreferences
} from "./runtimePreferences";

if (process.platform === "linux") app.setName("robosats-exp");
if (process.platform === "win32") app.setAppUserModelId("org.robosats.experimental");

protocol.registerSchemesAsPrivileged([{
  scheme: "robosats",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true
  }
}]);

const partition = "persist:robosats";
const desktopRoot = path.resolve(__dirname, "../..");
const projectRoot = path.resolve(desktopRoot, "..");
const webRoot = app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(projectRoot, "dist");
const sidecarName = process.platform === "win32" ? "robosats-arti.exe" : "robosats-arti";
const sidecarPath = app.isPackaged
  ? path.join(process.resourcesPath, "bin", sidecarName)
  : path.join(desktopRoot, "build", "bin", sidecarName);
const windowIcon = process.platform === "darwin" ? undefined : path.join(desktopRoot, "assets", "icon.png");
const maxAutomaticRestarts = 3;

let splashWindow: BrowserWindow | undefined;
let mainWindow: BrowserWindow | undefined;
let arti: ArtiProcess | undefined;
let artiReady: ArtiReady | undefined;
let starting = false;
let recoveryRunning = false;
let quitting = false;
let automaticRestartCount = 0;
let automaticRestartTimer: NodeJS.Timeout | undefined;
let networkRecoveryTimer: NodeJS.Timeout | undefined;
let appBootTimeout: NodeJS.Timeout | undefined;
let preferences: RuntimePreferences = { notificationsEnabled: false };
let preferencesPath = "";
let loaderStatus: LoaderStatus = {
  progress: 2,
  message: "Starting private connection..."
};
let runtimeStatus: RuntimeStatus = {
  state: "off",
  progress: 0,
  networkAvailable: true,
  error: null
};

type LoaderStatus = {
  progress: number;
  message: string;
  error?: string;
};

type ArtiReady = {
  port: number;
  version: string;
};

type RuntimeStatus = {
  state: "connected" | "connecting" | "failed" | "off";
  progress: number;
  networkAvailable: boolean;
  error: string | null;
};

app.whenReady().then(async () => {
  preferencesPath = path.join(app.getPath("userData"), "runtime-preferences.json");
  preferences = readRuntimePreferences(preferencesPath);
  runtimeStatus.networkAvailable = electronNet.isOnline();
  registerIpc();
  registerRecoveryHandlers();
  createSplashWindow();
  await startDesktop();

  app.on("activate", () => {
    if (!mainWindow && !starting) void startDesktop();
  });
});

app.on("before-quit", () => {
  quitting = true;
  clearTimeout(automaticRestartTimer);
  clearTimeout(networkRecoveryTimer);
  arti?.stop();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

async function startDesktop(options: { automatic?: boolean } = {}): Promise<void> {
  if (starting || quitting) return;
  starting = true;
  const restoringExistingWindow = Boolean(mainWindow && !mainWindow.isDestroyed());
  mainWindow?.hide();
  createSplashWindow();
  showLoader({ progress: 2, message: "Starting private connection..." });
  updateRuntimeStatus({ state: "connecting", progress: 0, error: null });
  artiReady = undefined;
  arti?.stop();

  let nextArti: ArtiProcess;
  nextArti = new ArtiProcess(
    sidecarPath,
    path.join(app.getPath("userData"), "arti"),
    reportArtiProgress,
    (message) => {
      if (arti === nextArti) handleUnexpectedArtiExit(message);
    }
  );
  arti = nextArti;

  try {
    const ready = await nextArti.start();
    if (arti !== nextArti || quitting) return;
    artiReady = ready;
    automaticRestartCount = 0;
    showLoader({ progress: 70, message: "Private connection established." });
    updateRuntimeStatus({ state: "connected", progress: 100, error: null });
    await configureTorSession(ready.port);

    if (restoringExistingWindow && mainWindow && !mainWindow.isDestroyed()) {
      showLoader({ progress: 100, message: "RoboSats is ready." });
      setTimeout(() => {
        mainWindow?.show();
        mainWindow?.focus();
        notifyTransportRestored();
        splashWindow?.close();
      }, 180);
    } else {
      createMainWindow();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the private connection";
    updateRuntimeStatus({ state: "failed", progress: 0, error: sanitizeError(message) });
    if (options.automatic && automaticRestartCount < maxAutomaticRestarts) {
      scheduleAutomaticRestart(message);
    } else {
      showFatalError(message);
    }
  } finally {
    starting = false;
  }
}

async function configureTorSession(port: number): Promise<void> {
  const appSession = session.fromPartition(partition, { cache: true });
  await appSession.setProxy({
    mode: "fixed_servers",
    proxyRules: `socks5://127.0.0.1:${port}`,
    proxyBypassRules: "<-loopback>"
  });
  await appSession.clearHostResolverCache();
  if (!appSession.protocol.isProtocolHandled("robosats")) {
    registerAppProtocol(appSession.protocol, webRoot);
  }
  configureSession(appSession);
}

function createSplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.show();
    splashWindow.focus();
    return;
  }
  splashWindow = new BrowserWindow({
    width: 430,
    height: 570,
    minWidth: 360,
    minHeight: 500,
    show: true,
    icon: windowIcon,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: "#0b0909",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "splashPreload.js")
    }
  });
  splashWindow.removeMenu();
  void splashWindow.loadFile(path.join(desktopRoot, "assets", "splash.html"));
  splashWindow.webContents.once("did-finish-load", () => {
    splashWindow?.webContents.send("desktop:loader-status", loaderStatus);
  });
  splashWindow.on("closed", () => {
    splashWindow = undefined;
    if (!mainWindow?.isVisible()) app.quit();
  });
}

function createMainWindow(): void {
  mainWindow?.destroy();
  const appSession = session.fromPartition(partition);
  const titleBar = process.platform === "darwin"
    ? { titleBarStyle: "hiddenInset" as const }
    : {
        titleBarStyle: "hidden" as const,
        titleBarOverlay: {
          color: "#0b0909",
          symbolColor: "#f4f1ed",
          height: 38
        }
      };
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 360,
    minHeight: 560,
    show: false,
    icon: windowIcon,
    autoHideMenuBar: true,
    backgroundColor: "#0b0909",
    ...titleBar,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, "preload.js"),
      session: appSession
    }
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("robosats://app/")) return;
    event.preventDefault();
    openExternal(url);
  });
  mainWindow.webContents.on("did-finish-load", sendRuntimeState);
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    showFatalError(`The application renderer stopped: ${details.reason}`);
  });
  mainWindow.on("closed", () => {
    clearAppBootTimeout();
    mainWindow = undefined;
  });
  clearAppBootTimeout();
  appBootTimeout = setTimeout(() => {
    showFatalError("The application interface did not finish loading");
  }, 90_000);
  void mainWindow.loadURL("robosats://app/#/garage").catch((error: Error) => {
    showFatalError(error.message);
  });
}

function configureSession(appSession: Electron.Session): void {
  appSession.setPermissionCheckHandler(() => false);
  appSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

function registerIpc(): void {
  ipcMain.on("desktop:retry", (event) => {
    if (event.sender !== splashWindow?.webContents) return;
    automaticRestartCount = 0;
    if (!starting) void startDesktop();
  });
  ipcMain.on("desktop:boot-stage", (event, detail: { progress?: number; message?: string }) => {
    if (event.sender !== mainWindow?.webContents) return;
    const appProgress = Number.isFinite(detail.progress) ? Math.max(0, Math.min(100, detail.progress ?? 0)) : 0;
    showLoader({
      progress: 70 + (appProgress * 0.29),
      message: detail.message ?? "Preparing RoboSats..."
    });
  });
  ipcMain.on("desktop:app-ready", (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    clearAppBootTimeout();
    showLoader({ progress: 100, message: "RoboSats is ready." });
    setTimeout(() => {
      mainWindow?.show();
      mainWindow?.focus();
      splashWindow?.close();
    }, 180);
  });
  ipcMain.on("desktop:get-tor-diagnostics", (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    event.returnValue = JSON.stringify(torDiagnostics());
  });
  ipcMain.on("desktop:get-notification-state", (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    event.returnValue = JSON.stringify(notificationState());
  });
  ipcMain.on("desktop:set-notifications-enabled", (event, enabled: unknown) => {
    if (event.sender !== mainWindow?.webContents || typeof enabled !== "boolean") return;
    preferences = { ...preferences, notificationsEnabled: enabled };
    writeRuntimePreferences(preferencesPath, preferences);
    sendRuntimeState();
  });
  ipcMain.on("desktop:show-notification", (event, value: unknown) => {
    if (event.sender !== mainWindow?.webContents) return;
    showDesktopNotification(value);
  });
  ipcMain.on("desktop:network-changed", (event, available: unknown) => {
    if (event.sender !== mainWindow?.webContents || typeof available !== "boolean") return;
    updateRuntimeStatus({ networkAvailable: available });
    if (available) scheduleNetworkRecovery();
  });
}

function registerRecoveryHandlers(): void {
  powerMonitor.on("resume", () => {
    void recoverAfterInterruption();
  });
}

async function recoverAfterInterruption(): Promise<void> {
  if (recoveryRunning || starting || quitting) return;
  recoveryRunning = true;
  try {
    const networkAvailable = electronNet.isOnline();
    updateRuntimeStatus({ networkAvailable });
    if (!networkAvailable) return;
    if (artiReady && await isLoopbackPortOpen(artiReady.port)) {
      await session.fromPartition(partition).clearHostResolverCache();
      updateRuntimeStatus({ state: "connected", progress: 100, error: null });
      notifyTransportRestored();
      return;
    }
    await startDesktop();
  } finally {
    recoveryRunning = false;
  }
}

function scheduleNetworkRecovery(): void {
  clearTimeout(networkRecoveryTimer);
  networkRecoveryTimer = setTimeout(() => {
    void recoverAfterInterruption();
  }, 1_000);
}

function handleUnexpectedArtiExit(message: string): void {
  if (quitting) return;
  artiReady = undefined;
  mainWindow?.hide();
  createSplashWindow();
  updateRuntimeStatus({ state: "failed", progress: 0, error: sanitizeError(message) });
  scheduleAutomaticRestart(message);
}

function scheduleAutomaticRestart(message: string): void {
  clearTimeout(automaticRestartTimer);
  if (automaticRestartCount >= maxAutomaticRestarts) {
    showFatalError(message);
    return;
  }
  automaticRestartCount += 1;
  showLoader({
    progress: 1,
    message: `Restoring private connection (${automaticRestartCount}/${maxAutomaticRestarts})...`
  });
  automaticRestartTimer = setTimeout(() => {
    void startDesktop({ automatic: true });
  }, automaticRestartCount * 1_000);
}

function notifyTransportRestored(): void {
  mainWindow?.webContents.send("desktop:transport-restored", {
    torReady: true,
    transportRefreshed: true
  });
}

function reportArtiProgress(status: ArtiProgress): void {
  updateRuntimeStatus({ state: "connecting", progress: status.progress, error: null });
  showLoader({
    progress: 4 + (Math.max(0, Math.min(100, status.progress)) * 0.64),
    message: readableArtiStage(status)
  });
}

function readableArtiStage(status: ArtiProgress): string {
  if (status.progress < 5) return "Starting private connection...";
  if (status.progress < 35) return "Finding the Tor network...";
  if (status.progress < 80) return "Building a private route...";
  return "Finishing the private connection...";
}

function showFatalError(message: string): void {
  clearAppBootTimeout();
  mainWindow?.hide();
  createSplashWindow();
  updateRuntimeStatus({ state: "failed", progress: 0, error: sanitizeError(message) });
  showLoader({
    progress: 0,
    message: "Private connection failed.",
    error: sanitizeError(message)
  });
}

function showLoader(status: LoaderStatus): void {
  loaderStatus = status;
  if (!splashWindow || splashWindow.isDestroyed()) createSplashWindow();
  splashWindow?.webContents.send("desktop:loader-status", status);
}

function updateRuntimeStatus(patch: Partial<RuntimeStatus>): void {
  runtimeStatus = { ...runtimeStatus, ...patch };
  sendRuntimeState();
}

function sendRuntimeState(): void {
  mainWindow?.webContents.send("desktop:runtime-state");
}

function torDiagnostics() {
  const networkAvailable = electronNet.isOnline();
  return {
    connected: runtimeStatus.state === "connected" && networkAvailable && Boolean(artiReady),
    state: runtimeStatus.state,
    socksHost: artiReady ? "127.0.0.1" : null,
    socksPort: artiReady?.port ?? null,
    implementation: "Embedded Arti sidecar",
    artiVersion: artiReady?.version ?? "Unavailable",
    bootstrapProgress: runtimeStatus.progress,
    clientInitialized: Boolean(artiReady),
    proxyRunning: Boolean(artiReady),
    networkAvailable,
    routing: "Desktop HTTP and WebSocket traffic through Tor",
    appVersion: app.getVersion(),
    error: runtimeStatus.error
  };
}

function notificationState() {
  return {
    enabled: preferences.notificationsEnabled,
    permissionGranted: Notification.isSupported(),
    permissionRequired: false
  };
}

function showDesktopNotification(value: unknown): void {
  if (!preferences.notificationsEnabled || !Notification.isSupported() || mainWindow?.isFocused()) return;
  const payload = normalizeNotificationPayload(value);
  if (!payload) return;
  const notification = new Notification({
    title: payload.title,
    body: payload.body,
    timeoutType: "default"
  });
  notification.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
    if (payload.route) mainWindow?.webContents.send("desktop:navigate", payload.route);
  });
  notification.show();
}

function isLoopbackPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const socket = createConnection({ host: "127.0.0.1", port }, () => finish(true));
    socket.setTimeout(1_500, () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function clearAppBootTimeout(): void {
  if (appBootTimeout) clearTimeout(appBootTimeout);
  appBootTimeout = undefined;
}

function sanitizeError(message: string): string {
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim();
  return firstLine?.slice(0, 180) || "The private connection stopped unexpectedly.";
}

function openExternal(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") void shell.openExternal(url.toString());
  } catch {
    return;
  }
}
