import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("RobosatsSettings", "desktop-basic");

window.addEventListener("DOMContentLoaded", () => {
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
});
