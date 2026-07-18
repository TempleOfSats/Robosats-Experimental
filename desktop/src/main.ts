import { app, BrowserWindow, ipcMain, protocol, session, shell } from "electron";
import path from "node:path";
import { ArtiProcess, type ArtiProgress } from "./artiProcess";
import { registerAppProtocol } from "./appProtocol";

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

let splashWindow: BrowserWindow | undefined;
let mainWindow: BrowserWindow | undefined;
let arti: ArtiProcess | undefined;
let starting = false;
let appBootTimeout: NodeJS.Timeout | undefined;
let loaderStatus: LoaderStatus = {
  progress: 2,
  message: "Starting private connection..."
};

type LoaderStatus = {
  progress: number;
  message: string;
  error?: string;
};

app.whenReady().then(async () => {
  registerIpc();
  createSplashWindow();
  await startDesktop();

  app.on("activate", () => {
    if (!mainWindow && !starting) void startDesktop();
  });
});

app.on("before-quit", () => arti?.stop());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

async function startDesktop(): Promise<void> {
  if (starting) return;
  starting = true;
  showLoader({ progress: 2, message: "Starting private connection..." });
  arti?.stop();
  arti = new ArtiProcess(sidecarPath, path.join(app.getPath("userData"), "arti"), reportArtiProgress, showFatalError);

  try {
    const ready = await arti.start();
    showLoader({ progress: 70, message: "Private connection established." });
    const appSession = session.fromPartition(partition, { cache: true });
    await appSession.setProxy({
      mode: "fixed_servers",
      proxyRules: `socks5://127.0.0.1:${ready.port}`,
      proxyBypassRules: "<-loopback>"
    });
    await appSession.clearHostResolverCache();
    if (!appSession.protocol.isProtocolHandled("robosats")) {
      registerAppProtocol(appSession.protocol, webRoot);
    }
    configureSession(appSession);
    createMainWindow();
  } catch (error) {
    showFatalError(error instanceof Error ? error.message : "Could not start the private connection");
  } finally {
    starting = false;
  }
}

function createSplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.show();
    return;
  }
  splashWindow = new BrowserWindow({
    width: 430,
    height: 570,
    minWidth: 360,
    minHeight: 500,
    show: false,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: "#0b1320",
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
  splashWindow.once("ready-to-show", () => splashWindow?.show());
  splashWindow.on("closed", () => {
    splashWindow = undefined;
    if (!mainWindow) app.quit();
  });
}

function createMainWindow(): void {
  mainWindow?.destroy();
  const appSession = session.fromPartition(partition);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 360,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0b1320",
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
}

function reportArtiProgress(status: ArtiProgress): void {
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
