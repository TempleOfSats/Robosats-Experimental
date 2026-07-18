import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  appImageArchitecture,
  appImagePluginPath,
  removeBundledWaylandLibraries
} from "./appimage.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);
const requested = process.argv[2] ?? platformName();
const targets = new Set(["linux", "windows", "macos"]);
if (!targets.has(requested)) throw new Error(`Unsupported desktop target: ${requested}`);

const bundles = {
  linux: "appimage",
  windows: "nsis",
  macos: "dmg"
};
await rm(path.join(
  root,
  "desktop",
  "src-tauri",
  "target",
  "release",
  "bundle",
  bundles[requested]
), { recursive: true, force: true });
const buildEnvironment = await packagingEnvironment();
await run(process.execPath, [
  require.resolve("@tauri-apps/cli/tauri.js"),
  "build",
  "--config",
  "desktop/src-tauri/tauri.conf.json",
  "--bundles",
  bundles[requested]
], buildEnvironment);
if (requested === "linux") await repackLinuxAppImage();
await collectArtifacts(requested);

function platformName() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

async function packagingEnvironment() {
  if (requested !== "linux") return process.env;
  const env = { ...process.env, NO_STRIP: "1" };
  const helpers = "/usr/lib/gstreamer-1.0";
  try {
    await access(path.join(helpers, "gst-plugin-scanner"));
    env.GSTREAMER_HELPERS_DIR = helpers;
  } catch {}
  return env;
}

function run(command, args, env, workingDirectory = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workingDirectory,
      env,
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function repackLinuxAppImage() {
  const bundleDirectory = path.join(
    root,
    "desktop",
    "src-tauri",
    "target",
    "release",
    "bundle",
    "appimage"
  );
  const appDirectories = await findDirectories(bundleDirectory, ".AppDir");
  const appImages = await findFiles(bundleDirectory, [".AppImage"]);
  if (appDirectories.length !== 1 || appImages.length !== 1) {
    throw new Error("Expected one Linux AppDir and one AppImage");
  }

  const removed = await removeBundledWaylandLibraries(appDirectories[0]);
  if (removed.length === 0) return;

  const plugin = appImagePluginPath();
  await access(plugin);
  const replacement = `${appImages[0]}.portable.AppImage`;
  await rm(replacement, { force: true });
  await run(plugin, [`--appdir=${appDirectories[0]}`], {
    ...process.env,
    APPIMAGE_EXTRACT_AND_RUN: "1",
    ARCH: appImageArchitecture(),
    LDAI_OUTPUT: replacement
  }, bundleDirectory);
  await access(replacement);
  await rename(replacement, appImages[0]);
  console.log(`Excluded ${removed.length} host-sensitive Wayland libraries`);
}

async function collectArtifacts(platform) {
  const extensions = {
    linux: [".AppImage"],
    windows: [".exe"],
    macos: [".dmg"]
  }[platform];
  const bundleDirectory = path.join(root, "desktop", "src-tauri", "target", "release", "bundle");
  const files = await findFiles(bundleDirectory, extensions);
  if (files.length === 0) throw new Error(`No ${platform} desktop package was produced`);
  const releaseDirectory = path.join(root, "desktop", "release");
  await mkdir(releaseDirectory, { recursive: true });
  for (const source of files) {
    await copyFile(source, path.join(releaseDirectory, path.basename(source)));
  }
}

async function findFiles(directory, extensions) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await findFiles(absolute, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) results.push(absolute);
  }
  return results;
}

async function findDirectories(directory, suffix) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith(suffix)) results.push(absolute);
    else results.push(...await findDirectories(absolute, suffix));
  }
  return results;
}
