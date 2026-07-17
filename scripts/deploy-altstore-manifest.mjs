#!/usr/bin/env node
// Deploys the AltStore manifest to GitHub Pages (gh-pages branch).
//
// Commits altstore.json to the gh-pages branch and pushes it.
// Designed to run in GitHub Actions after a release.
//
// Usage:
//   node scripts/deploy-altstore-manifest.mjs
//
// Requires:
//   - GITHUB_TOKEN with contents:write and pages:write permissions
//   - altstore.json exists in the repo root

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const BRANCH = "gh-pages";
const FILE = "altstore.json";

function log(...args) {
  console.log("[deploy]", ...args);
}

function runCmd(cmd, ...args) {
  return execFileSync(cmd, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function main() {
  const manifestPath = resolve(ROOT, FILE);

  if (!existsSync(manifestPath)) {
    log(`Error: ${FILE} not found at ${manifestPath}`);
    process.exit(1);
  }

  log(`Deploying ${FILE} to ${BRANCH}...`);

  // Configure git for GitHub token auth
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    log("Error: GITHUB_TOKEN is not set.");
    process.exit(1);
  }

  const repoUrl = `https://x-access-token:${token}@github.com/TempleOfSats/Robosats-Experimental.git`;

  // Clone (or re-init) the gh-pages branch
  const pagesDir = resolve(ROOT, ".gh-pages-tmp");

  try {
    runCmd("rm", "-rf", pagesDir);
  } catch {}

  // Clone gh-pages; if it does not exist yet, clone main and create it
  try {
    runCmd("git", "clone", "--branch", BRANCH, "--single-branch", "--depth", "1", repoUrl, pagesDir);
  } catch {
    log("gh-pages branch does not exist yet — creating from main...");
    runCmd("git", "clone", "--branch", "main", "--single-branch", "--depth", "1", repoUrl, pagesDir);
    runCmd("git", "-C", pagesDir, "checkout", "--orphan", BRANCH);
    runCmd("git", "-C", pagesDir, "rm", "-rf", ".");
  }

  // Copy manifest
  runCmd("cp", manifestPath, resolve(pagesDir, FILE));

  // Commit and push
  runCmd("git", "-C", pagesDir, "config", "user.email", "actions@github.com");
  runCmd("git", "-C", pagesDir, "config", "user.name", "GitHub Actions");
  runCmd("git", "-C", pagesDir, "add", FILE);

  const status = runCmd("git", "-C", pagesDir, "status", "--porcelain");
  if (!status) {
    log("No changes to deploy.");
    return;
  }

  runCmd("git", "-C", pagesDir, "commit", "-m", `Update AltStore manifest`);
  runCmd("git", "-C", pagesDir, "push", "origin", BRANCH);

  log(`Deployed to https://TempleOfSats.github.io/Robosats-Experimental/${FILE}`);
}

main();
