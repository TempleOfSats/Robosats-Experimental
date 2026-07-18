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
const destinationDirectory = path.join(desktop, "build", "bin");
const destination = path.join(destinationDirectory, executableName);
const typescriptCli = path.join(root, "node_modules", "typescript", "bin", "tsc");

await run("cargo", ["build", "--release", "--locked", "--manifest-path", manifest], root);
await run(process.execPath, [typescriptCli, "-p", "desktop/tsconfig.json"], root);
await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
if (process.platform !== "win32") await chmod(destination, 0o755);

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}
