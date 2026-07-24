#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const distRoot = resolve("dist");
const forbiddenNames = /(?:TradeLab|tradePreviewFixtures)/i;
const forbiddenContent = /__dev\/trade-lab/;
const indexHtml = await readFile(resolve(distRoot, "index.html"), "utf8");
const files = await listFiles(distRoot);

if (!/["']\/assets\/[^/"']+\/robosats-exp\.[^"']+\.js["']/.test(indexHtml)) {
  throw new Error("Production entry assets must be namespaced by build revision.");
}

for (const path of files) {
  if (forbiddenNames.test(path)) {
    throw new Error(`Development-only module emitted in production build: ${path}`);
  }
  if (path.endsWith(".wasm")) {
    throw new Error(`Unexpected WebAssembly emitted in production build: ${path}`);
  }

  if (/\.(?:html|js|css)$/.test(path)) {
    const content = await readFile(path, "utf8");
    if (forbiddenContent.test(content)) {
      throw new Error(`Development-only route emitted in production build: ${path}`);
    }
  }
}

const identityFiles = files.filter((path) => /roboidentitiesClient|robot-identities/.test(path));
const identityTransferBytes = identityFiles.reduce((total, path) => {
  const content = readFileSync(path);
  return total + (path.endsWith(".js") ? gzipSync(content, { level: 9 }).length : content.length);
}, 0);
if (identityFiles.length !== 2 || identityTransferBytes > 230_000) {
  throw new Error(`Browser identity payload exceeds its budget: ${identityTransferBytes} bytes`);
}

console.log(`Production bundle excludes the Trade Lab and identity WASM (${identityTransferBytes} byte identity payload).`);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }

  return files;
}
