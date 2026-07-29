#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(appRoot, "dist");
const targetDir = process.env.ROBOSATS_NGINX_ROOT ?? "/srv/robosats-exp";
const nextDir = `${targetDir}.next-${process.pid}`;
const previousDir = `${targetDir}.previous`;

if (!existsSync(resolve(distDir, "index.html"))) {
  throw new Error("Missing production build. Run npm run build first.");
}

execFileSync("sudo", ["rm", "-rf", nextDir, previousDir], { stdio: "inherit" });
execFileSync("sudo", ["install", "-d", "-m", "0755", nextDir], { stdio: "inherit" });
if (existsSync(resolve(targetDir, "assets"))) {
  execFileSync("sudo", ["cp", "-a", resolve(targetDir, "assets"), resolve(nextDir, "assets")], { stdio: "inherit" });
  retainCurrentGeneration(targetDir, resolve(nextDir, "assets"), "assets");
}
if (existsSync(resolve(targetDir, "static"))) {
  execFileSync("sudo", ["cp", "-a", resolve(targetDir, "static"), resolve(nextDir, "static")], { stdio: "inherit" });
  retainCurrentGeneration(targetDir, resolve(nextDir, "static"), "static");
}
execFileSync("sudo", ["cp", "-a", `${distDir}/.`, nextDir], { stdio: "inherit" });
execFileSync("sudo", ["chmod", "-R", "a+rX", nextDir], { stdio: "inherit" });
if (existsSync(targetDir)) {
  execFileSync("sudo", ["mv", targetDir, previousDir], { stdio: "inherit" });
}
execFileSync("sudo", ["mv", nextDir, targetDir], { stdio: "inherit" });
execFileSync("sudo", ["rm", "-rf", previousDir], { stdio: "inherit" });
execFileSync("sudo", ["nginx", "-t"], { stdio: "inherit" });
execFileSync("sudo", ["nginx", "-s", "reload"], { stdio: "inherit" });
console.log(`Deployed production frontend to ${targetDir}`);

function retainCurrentGeneration(currentRoot, copiedRoot, kind) {
  const indexPath = resolve(currentRoot, "index.html");
  if (!existsSync(indexPath)) return;

  const pattern = kind === "assets"
    ? /["']\/assets\/([^/"']+)\/robosats-exp\./
    : /["']\/static\/([0-9a-f]{16})\//;
  const match = readFileSync(indexPath, "utf8").match(pattern);
  if (!match) return;

  const currentGeneration = match[1];
  for (const entry of readdirSync(copiedRoot)) {
    const path = resolve(copiedRoot, entry);
    if (entry === currentGeneration && statSync(path).isDirectory()) continue;
    execFileSync("sudo", ["rm", "-rf", path], { stdio: "inherit" });
  }
}
