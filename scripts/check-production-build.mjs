#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const distRoot = resolve("dist");
const forbiddenNames = /(?:TradeLab|tradePreviewFixtures)/i;
const forbiddenContent = /__dev\/trade-lab/;
const indexHtml = await readFile(resolve(distRoot, "index.html"), "utf8");

if (!/["']\/assets\/[^/"']+\/robosats-exp\.[^"']+\.js["']/.test(indexHtml)) {
  throw new Error("Production entry assets must be namespaced by build revision.");
}

for (const path of await listFiles(distRoot)) {
  if (forbiddenNames.test(path)) {
    throw new Error(`Development-only module emitted in production build: ${path}`);
  }

  if (/\.(?:html|js|css)$/.test(path)) {
    const content = await readFile(path, "utf8");
    if (forbiddenContent.test(content)) {
      throw new Error(`Development-only route emitted in production build: ${path}`);
    }
  }
}

console.log("Production bundle excludes the Trade Lab.");

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
