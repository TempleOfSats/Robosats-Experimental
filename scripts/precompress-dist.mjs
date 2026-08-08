#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { constants, brotliCompressSync, gzipSync } from "node:zlib";

const distRoot = resolve("dist");
const compressible = /\.(?:asc|css|html|js|json|mjs|rsid|svg|txt|wasm|xml)$/i;
const minimumBytes = 1024;
let sourceBytes = 0;
let brotliBytes = 0;
let gzipBytes = 0;
let compressedFiles = 0;

for (const path of await listFiles(distRoot)) {
  if (!compressible.test(path) || path.endsWith(".br") || path.endsWith(".gz")) continue;
  const file = await stat(path);
  if (file.size < minimumBytes) continue;

  const content = await readFile(path);
  const brotli = brotliCompressSync(content, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
      [constants.BROTLI_PARAM_QUALITY]: 11
    }
  });
  const gzip = gzipSync(content, { level: 9 });

  await Promise.all([
    writeFile(`${path}.br`, brotli),
    writeFile(`${path}.gz`, gzip)
  ]);
  sourceBytes += content.length;
  brotliBytes += brotli.length;
  gzipBytes += gzip.length;
  compressedFiles += 1;
}

console.log(
  `Precompressed ${compressedFiles} files: ${format(sourceBytes)} raw, ` +
    `${format(brotliBytes)} Brotli q11, ${format(gzipBytes)} gzip 9.`
);

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

function format(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
