#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const requiredAssets = [
  {
    directoryUrl: "/static/assets/payment-methods/",
    path: "static/assets/payment-methods/pix.png"
  },
  {
    directoryUrl: "/static/federation/avatars/",
    path: "static/federation/avatars/lake.webp"
  }
];

export async function checkDesktopFrontendAssets(distRoot) {
  const files = await listFiles(distRoot);
  const textFiles = files.filter((file) => /\.(?:css|html|js|json|mjs|svg|txt|xml)$/i.test(file));
  const text = (await Promise.all(textFiles.map((file) => readFile(file, "utf8")))).join("\n");

  if (/\/static\/[0-9a-f]{16}\//.test(text)) {
    throw new Error("Desktop frontend must not persist web-only versioned static asset URLs.");
  }

  for (const asset of requiredAssets) {
    if (!text.includes(asset.directoryUrl)) {
      throw new Error(`Desktop frontend does not reference ${asset.directoryUrl}`);
    }
    let info;
    try {
      info = await stat(path.join(distRoot, asset.path));
    } catch (error) {
      throw new Error(`Desktop frontend is missing packaged asset: ${asset.path}`, { cause: error });
    }
    if (!info.isFile()) throw new Error(`Desktop frontend asset is not a file: ${asset.path}`);
  }

  return requiredAssets.map((asset) => asset.path);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(absolute)));
    else files.push(absolute);
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const assets = await checkDesktopFrontendAssets(path.resolve("dist"));
  console.log(`Desktop frontend embeds ${assets.length} checked static asset families at stable URLs.`);
}
