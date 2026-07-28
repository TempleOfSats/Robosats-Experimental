#!/usr/bin/env node
import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist");
let removed = 0;

for (const path of await listFiles(root)) {
  if (!path.endsWith(".br") && !path.endsWith(".gz")) continue;
  await rm(path);
  removed += 1;
}

console.log(`Removed ${removed} web-server compression sidecars from ${root}.`);

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
