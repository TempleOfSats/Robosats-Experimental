import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("RobosatsSettings", "desktop-basic");
contextBridge.exposeInMainWorld("RoboSatsDesktop", {
  platform: process.platform,
  getTorDiagnostics: () => ipcRenderer.sendSync("desktop:get-tor-diagnostics"),
  getNotificationState: () => ipcRenderer.sendSync("desktop:get-notification-state"),
  setNotificationsEnabled: (enabled: boolean) => {
    ipcRenderer.send("desktop:set-notifications-enabled", enabled);
  },
  showNotification: (payload: unknown) => {
    ipcRenderer.send("desktop:show-notification", payload);
  }
});

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktopPlatform = process.platform;
  window.addEventListener("robosats:boot-stage", (event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined;
    ipcRenderer.send("desktop:boot-stage", {
      progress: typeof detail?.progress === "number" ? detail.progress : undefined,
      message: typeof detail?.message === "string" ? detail.message : undefined
    });
  });
  window.addEventListener("robosats:app-ready", () => {
    ipcRenderer.send("desktop:app-ready");
  }, { once: true });
  window.addEventListener("online", () => {
    ipcRenderer.send("desktop:network-changed", true);
  });
  window.addEventListener("offline", () => {
    ipcRenderer.send("desktop:network-changed", false);
  });
});

ipcRenderer.on("desktop:runtime-state", () => {
  window.dispatchEvent(new CustomEvent("robosats:desktop-runtime-state"));
});

ipcRenderer.on("desktop:transport-restored", (_event, detail) => {
  window.dispatchEvent(new CustomEvent("robosats:tor-reconnected", { detail }));
  window.dispatchEvent(new CustomEvent("robosats:native-resume", { detail }));
});

ipcRenderer.on("desktop:navigate", (_event, route: unknown) => {
  if (typeof route !== "string" || !/^\/order\/[a-z0-9-]+\/[1-9]\d*$/i.test(route)) return;
  window.location.hash = `#${route}`;
});
