import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopLoader", {
  retry: () => ipcRenderer.send("desktop:retry"),
  onStatus: (listener: (status: unknown) => void) => {
    ipcRenderer.on("desktop:loader-status", (_event, status) => listener(status));
  }
});
