#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(appRoot, "dist");
const cspCheckScript = resolve(appRoot, "scripts/check-web-csp.mjs");
const securityHeadersSource = resolve(appRoot, "nodeapp/security-headers.conf");
const securityHeadersTarget = process.env.ROBOSATS_NGINX_SECURITY_HEADERS ?? "/etc/nginx/security-headers.conf";
const targetDir = process.env.ROBOSATS_NGINX_ROOT ?? "/srv/robosats-exp";
const nextDir = `${targetDir}.next-${process.pid}`;
const previousDir = `${targetDir}.previous`;
const nextSecurityHeaders = `${securityHeadersTarget}.next-${process.pid}`;
const previousSecurityHeaders = `${securityHeadersTarget}.previous-${process.pid}`;

if (!existsSync(resolve(distDir, "index.html"))) {
  throw new Error("Missing production build. Run npm run build first.");
}
if (!existsSync(securityHeadersSource)) {
  throw new Error(`Missing shared Nginx security headers at ${securityHeadersSource}.`);
}

execFileSync(process.execPath, [cspCheckScript], { stdio: "inherit" });
const hadSecurityHeaders = existsSync(securityHeadersTarget);
const hadLiveSite = existsSync(targetDir);
let installedSecurityHeaders = false;
let movedPreviousSite = false;
let installedNextSite = false;

execFileSync("sudo", ["rm", "-rf", nextDir, previousDir], { stdio: "inherit" });
execFileSync("sudo", ["rm", "-f", nextSecurityHeaders, previousSecurityHeaders], { stdio: "inherit" });
execFileSync("sudo", ["install", "-m", "0644", securityHeadersSource, nextSecurityHeaders], {
  stdio: "inherit"
});
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

try {
  if (hadSecurityHeaders) {
    execFileSync("sudo", ["cp", "-p", securityHeadersTarget, previousSecurityHeaders], { stdio: "inherit" });
  }
  execFileSync("sudo", ["mv", nextSecurityHeaders, securityHeadersTarget], { stdio: "inherit" });
  installedSecurityHeaders = true;
  const activeConfig = execFileSync("sudo", ["nginx", "-T"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  });
  verifyLiveServerSecurity(activeConfig);
  execFileSync("sudo", ["nginx", "-t"], { stdio: "inherit" });

  if (hadLiveSite) {
    execFileSync("sudo", ["mv", targetDir, previousDir], { stdio: "inherit" });
    movedPreviousSite = true;
  }
  execFileSync("sudo", ["mv", nextDir, targetDir], { stdio: "inherit" });
  installedNextSite = true;
  execFileSync("sudo", ["nginx", "-s", "reload"], { stdio: "inherit" });
} catch (error) {
  if (installedNextSite) bestEffortSudo(["rm", "-rf", targetDir]);
  if (movedPreviousSite) bestEffortSudo(["mv", previousDir, targetDir]);
  if (installedSecurityHeaders) {
    if (hadSecurityHeaders) bestEffortSudo(["mv", previousSecurityHeaders, securityHeadersTarget]);
    else bestEffortSudo(["rm", "-f", securityHeadersTarget]);
  }
  bestEffortSudo(["rm", "-rf", nextDir]);
  bestEffortSudo(["rm", "-f", nextSecurityHeaders]);
  throw error;
}

bestEffortSudo(["rm", "-rf", previousDir]);
bestEffortSudo(["rm", "-f", previousSecurityHeaders]);
console.log(`Deployed production frontend to ${targetDir}`);

function retainCurrentGeneration(currentRoot, copiedRoot, kind) {
  const indexPath = resolve(currentRoot, "index.html");
  if (!existsSync(indexPath)) return;

  const pattern = kind === "assets" ? /["']\/assets\/([^/"']+)\/robosats-exp\./ : /["']\/static\/([0-9a-f]{16})\//;
  const match = readFileSync(indexPath, "utf8").match(pattern);
  if (!match) return;

  const currentGeneration = match[1];
  for (const entry of readdirSync(copiedRoot)) {
    const path = resolve(copiedRoot, entry);
    if (entry === currentGeneration && statSync(path).isDirectory()) continue;
    execFileSync("sudo", ["rm", "-rf", path], { stdio: "inherit" });
  }
}

function bestEffortSudo(args) {
  try {
    execFileSync("sudo", args, { stdio: "ignore" });
  } catch {
    console.error(`Rollback command failed: sudo ${args.join(" ")}`);
  }
}

function verifyLiveServerSecurity(source) {
  const lines = source.split(/\r?\n/);
  const targetRoot = `root ${targetDir};`;
  const rootLine = lines.findIndex((line) => line.trim() === targetRoot);
  if (rootLine < 0) throw new Error(`Active Nginx config does not serve ${targetDir}.`);

  const serverStart = findContainingServer(lines, rootLine);
  const serverEnd = findBlockEnd(lines, serverStart);
  const serverLines = lines.slice(serverStart + 1, serverEnd);
  const include = `include ${securityHeadersTarget};`;
  const firstLocation = serverLines.findIndex((line) => /^\s*location\b/.test(line));
  const serverDirectives = firstLocation < 0 ? serverLines : serverLines.slice(0, firstLocation);
  if (!serverDirectives.some((line) => line.trim() === include)) {
    throw new Error("Active Nginx server does not include the shared security headers.");
  }
  for (let index = 0; index < serverLines.length; index += 1) {
    if (!/^\s*location\b.*\{\s*$/.test(serverLines[index])) continue;
    const next = serverLines.slice(index + 1).find((line) => line.trim() && !line.trim().startsWith("#"));
    if (next?.trim() !== include) {
      throw new Error("Active Nginx location omits the shared security headers.");
    }
  }

  // nginx -T inlines every include, so a types block is present iff the
  // active config defines MIME types. Without it, scripts, styles, and
  // images fall back to application/octet-stream and the nosniff policy
  // makes browsers refuse to load the application.
  if (!/\btypes\s*\{/.test(source)) {
    throw new Error(
      "Active Nginx config has no MIME types. Add `include /etc/nginx/mime.types;` to the http context before deploying."
    );
  }
}

function findContainingServer(lines, targetLine) {
  for (let index = targetLine; index >= 0; index -= 1) {
    if (/^\s*server\s*\{\s*$/.test(lines[index]) && findBlockEnd(lines, index) >= targetLine) return index;
  }
  throw new Error(`Active Nginx config has no server block for ${targetDir}.`);
}

function findBlockEnd(lines, start) {
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    const structural = lines[index].replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#.*/g, "");
    depth += (structural.match(/\{/g) ?? []).length;
    depth -= (structural.match(/\}/g) ?? []).length;
    if (depth === 0) return index;
  }
  throw new Error("Active Nginx server block is incomplete.");
}
