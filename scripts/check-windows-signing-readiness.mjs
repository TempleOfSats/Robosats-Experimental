#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const applicationMode = process.argv.includes("--application");
const allowedArguments = new Set(["--application"]);
for (const argument of process.argv.slice(2)) {
  if (!allowedArguments.has(argument)) throw new Error(`Unknown option: ${argument}`);
}

const packageJson = readJson("package.json");
const tauriConfig = readJson("desktop/src-tauri/tauri.conf.json");
const cargoToml = readText("desktop/src-tauri/Cargo.toml");
const readme = readText("README.md");
const policy = readText("CODE_SIGNING_POLICY.md");
const privacy = readText("PRIVACY.md");
const license = readText("LICENSE");

assert(tauriConfig.version === "../../package.json",
  "Tauri version must continue to resolve from package.json");
assert(/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(packageJson.version),
  "package.json contains an unsupported release version");
assert(tauriConfig.productName === "RoboSats.Exp",
  "The Windows product name must remain RoboSats.Exp");
assert(tauriConfig.bundle?.shortDescription?.trim(),
  "The Windows bundle needs a short description");
assert(tauriConfig.bundle?.longDescription?.trim(),
  "The Windows bundle needs a long description");
assert(tauriConfig.bundle?.copyright?.trim(),
  "The Windows bundle needs copyright metadata");
assert(tauriConfig.bundle?.windows?.nsis?.installMode === "currentUser",
  "The NSIS installer must retain its current-user uninstall registration");
assert(cargoToml.includes('license = "AGPL-3.0-only"'),
  "The desktop package must declare its AGPL licence");
assert(license.includes("GNU AFFERO GENERAL PUBLIC LICENSE"),
  "The root licence must remain GNU AGPL");
assert(readme.includes("[Code signing policy](./CODE_SIGNING_POLICY.md)"),
  "README.md must link the code signing policy");
assert(policy.includes("Free code signing provided by SignPath.io, certificate by SignPath Foundation."),
  "The policy must contain the SignPath Foundation attribution");
assert(policy.includes("[privacy notice](./PRIVACY.md)"),
  "The policy must link the privacy notice");
assert(privacy.includes("coordinator APIs") && privacy.includes("Nostr relays"),
  "The privacy notice must disclose the application's network services");

const unresolved = policy.match(/REPLACE_WITH_[A-Z_]+/g) ?? [];
if (applicationMode && unresolved.length > 0) {
  throw new Error(
    `Code-signing policy is not ready for publication: ${[...new Set(unresolved)].join(", ")}`
  );
}

console.log(`Windows signing readiness checks passed for RoboSats.Exp ${packageJson.version}.`);
if (unresolved.length > 0) {
  console.log(
    "Pre-application mode: replace the documented role markers before applying to SignPath Foundation."
  );
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return readFileSync(`${root}/${relativePath}`, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
