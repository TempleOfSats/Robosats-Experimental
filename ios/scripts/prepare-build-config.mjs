#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseMetadata } from "../../scripts/release-metadata.mjs";

const iosRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageSource = await readFile(resolve(iosRoot, "../package.json"), "utf8");
const metadata = releaseMetadata(JSON.parse(packageSource).version);
const marketingVersion = process.env.ROBOSATS_IOS_VERSION ?? metadata.ios_version;
const buildNumber = process.env.ROBOSATS_BUILD_NUMBER ?? metadata.build_number;
const source = await readFile(resolve(iosRoot, "Config/Info.xtool.plist"), "utf8");
const destination = resolve(iosRoot, "build/Info.xtool.plist");
const versionFields = [
  "  <key>CFBundleShortVersionString</key>",
  `  <string>${escapeXml(marketingVersion)}</string>`,
  "  <key>CFBundleVersion</key>",
  `  <string>${escapeXml(buildNumber)}</string>`
].join("\n");
const output = source.replace("  <key>NSAppTransportSecurity</key>", `${versionFields}\n  <key>NSAppTransportSecurity</key>`);

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, output);

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
