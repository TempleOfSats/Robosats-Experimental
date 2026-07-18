import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const requested = process.argv[2] ?? platformName();
const targets = new Set(["linux", "win", "mac"]);
if (!targets.has(requested)) throw new Error(`Unsupported desktop target: ${requested}`);

const electronBuilder = path.join(root, "node_modules", "electron-builder", "cli.js");
await run(process.execPath, [
  electronBuilder,
  "--config",
  "desktop/electron-builder.cjs",
  `--${requested}`,
  `--${process.arch}`
]);

function platformName() {
  if (process.platform === "win32") return "win";
  if (process.platform === "darwin") return "mac";
  return "linux";
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}
