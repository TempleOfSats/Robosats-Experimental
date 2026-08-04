import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  WAYLAND_RUNTIME_LIBRARIES,
  appImageArchitecture,
  appImagePluginPath,
  configureAdaptiveGtkBackend,
  removeBundledWaylandLibraries
} from "./appimage.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("AppImage packaging", () => {
  it("removes bundled Wayland runtime libraries only", async () => {
    const appDirectory = await temporaryDirectory();
    const libraryDirectory = path.join(appDirectory, "usr", "lib");
    await mkdir(libraryDirectory, { recursive: true });
    for (const library of WAYLAND_RUNTIME_LIBRARIES) {
      await writeFile(path.join(libraryDirectory, library), library);
    }
    const retained = path.join(libraryDirectory, "libwebkit2gtk.so");
    await writeFile(retained, "webkit");

    const removed = await removeBundledWaylandLibraries(appDirectory);

    expect(removed.map((file) => path.basename(file)).sort())
      .toEqual([...WAYLAND_RUNTIME_LIBRARIES].sort());
    await expect(access(retained)).resolves.toBeUndefined();
    for (const library of WAYLAND_RUNTIME_LIBRARIES) {
      await expect(access(path.join(libraryDirectory, library))).rejects.toThrow();
    }
  });

  it("uses the Tauri cache and AppImage architecture names", () => {
    expect(appImagePluginPath({ XDG_CACHE_HOME: "/cache" }, "/home/user"))
      .toBe("/cache/tauri/linuxdeploy-plugin-appimage.AppImage");
    expect(appImagePluginPath({}, "/home/user"))
      .toBe("/home/user/.cache/tauri/linuxdeploy-plugin-appimage.AppImage");
    expect(appImageArchitecture("x64")).toBe("x86_64");
    expect(appImageArchitecture("arm64")).toBe("aarch64");
    expect(() => appImageArchitecture("riscv64")).toThrow(/Unsupported/);
  });

  it("uses Wayland when available while preserving overrides and X11 fallback", async () => {
    const appDirectory = await temporaryDirectory();
    const hooks = path.join(appDirectory, "apprun-hooks");
    const hook = path.join(hooks, "linuxdeploy-plugin-gtk.sh");
    await mkdir(hooks, { recursive: true });
    await writeFile(hook, "#!/bin/sh\nexport GDK_BACKEND=x11 # linuxdeploy default\nexec app\n");

    await expect(configureAdaptiveGtkBackend(appDirectory)).resolves.toBe(true);
    const configured = await readFile(hook, "utf8");
    expect(configured).toContain('[ -z "${GDK_BACKEND:-}" ]');
    expect(configured).toContain("GDK_BACKEND=wayland,x11");
    expect(configured).toContain("GDK_BACKEND=x11");
    await expect(configureAdaptiveGtkBackend(appDirectory)).resolves.toBe(false);
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "robosats-appimage-"));
  temporaryDirectories.push(directory);
  return directory;
}
