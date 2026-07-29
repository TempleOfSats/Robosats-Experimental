#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const BRANCH = "gh-pages";
const FILE = "altstore.json";

function log(...args) {
  console.log("[deploy]", ...args);
}

function runCmd(cmd, args, env = process.env) {
  return execFileSync(cmd, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env
  }).trim();
}

function main() {
  const manifestPath = resolve(ROOT, FILE);

  if (!existsSync(manifestPath)) {
    log(`Error: ${FILE} not found at ${manifestPath}`);
    process.exit(1);
  }

  log(`Deploying ${FILE} to ${BRANCH}...`);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    log("Error: GITHUB_TOKEN is not set.");
    process.exit(1);
  }
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !repository.includes("/")) {
    log("Error: GITHUB_REPOSITORY is not set.");
    process.exit(1);
  }

  const repoUrl = `https://github.com/${repository}.git`;
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`
  };
  const runGit = (...args) => runCmd("git", args, gitEnv);
  const pagesDir = resolve(ROOT, ".gh-pages-tmp");

  rmSync(pagesDir, { recursive: true, force: true });

  try {
    runGit("clone", "--branch", BRANCH, "--single-branch", "--depth", "1", repoUrl, pagesDir);
  } catch {
    log("Creating the gh-pages branch from main...");
    runGit("clone", "--branch", "main", "--single-branch", "--depth", "1", repoUrl, pagesDir);
    runGit("-C", pagesDir, "checkout", "--orphan", BRANCH);
    runGit("-C", pagesDir, "rm", "-rf", ".");
  }

  copyFileSync(manifestPath, resolve(pagesDir, FILE));

  runGit("-C", pagesDir, "config", "user.email", "actions@github.com");
  runGit("-C", pagesDir, "config", "user.name", "GitHub Actions");
  runGit("-C", pagesDir, "add", FILE);

  const status = runGit("-C", pagesDir, "status", "--porcelain");
  if (!status) {
    log("No changes to deploy.");
    return;
  }

  runGit("-C", pagesDir, "commit", "-m", "Update AltStore manifest");
  runGit("-C", pagesDir, "push", "origin", BRANCH);

  const [owner, name] = repository.split("/");
  log(`Deployed to https://${owner}.github.io/${name}/${FILE}`);
}

main();
