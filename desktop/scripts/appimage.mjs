import { homedir } from "node:os";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

export const WAYLAND_RUNTIME_LIBRARIES = new Set([
  "libwayland-client.so.0",
  "libwayland-cursor.so.0",
  "libwayland-egl.so.1",
  "libwayland-server.so.0"
]);

export async function removeBundledWaylandLibraries(appDirectory) {
  const removed = [];
  await visit(appDirectory);
  return removed;

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (WAYLAND_RUNTIME_LIBRARIES.has(entry.name)) {
        await rm(absolute, { force: true });
        removed.push(absolute);
      }
    }
  }
}

export function appImagePluginPath(environment = process.env, home = homedir()) {
  const cacheDirectory = environment.XDG_CACHE_HOME ?? path.join(home, ".cache");
  return path.join(cacheDirectory, "tauri", "linuxdeploy-plugin-appimage.AppImage");
}

export function appImageArchitecture(architecture = process.arch) {
  if (architecture === "x64") return "x86_64";
  if (architecture === "arm64") return "aarch64";
  throw new Error(`Unsupported Linux desktop architecture: ${architecture}`);
}
