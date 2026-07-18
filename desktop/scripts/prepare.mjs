import { chmod, copyFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const desktop = path.join(root, "desktop");
const manifest = path.join(desktop, "arti-sidecar", "Cargo.toml");
const executableName = process.platform === "win32" ? "robosats-arti.exe" : "robosats-arti";
const source = path.join(desktop, "arti-sidecar", "target", "release", executableName);
const targetTriple = await rustHostTriple();
const destinationDirectory = path.join(desktop, "src-tauri", "binaries");
const destination = path.join(
  destinationDirectory,
  `robosats-arti-${targetTriple}${process.platform === "win32" ? ".exe" : ""}`
);
const splashDirectory = path.join(root, "dist", "desktop");

await run("cargo", ["build", "--release", "--locked", "--manifest-path", manifest], root);
await mkdir(destinationDirectory, { recursive: true });
await mkdir(splashDirectory, { recursive: true });
await copyFile(source, destination);
await copyFile(path.join(desktop, "assets", "splash.html"), path.join(splashDirectory, "splash.html"));
await copyFile(path.join(desktop, "assets", "R-notext.svg"), path.join(splashDirectory, "R-notext.svg"));
if (process.platform !== "win32") await chmod(destination, 0o755);

async function rustHostTriple() {
  const output = await capture("rustc", ["-vV"], root);
  const host = output.match(/^host:\s+(.+)$/m)?.[1]?.trim();
  if (!host) throw new Error("Could not determine the Rust host target");
  return host;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function capture(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}: ${stderr}`));
    });
  });
}
