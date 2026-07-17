#!/usr/bin/env node
// Generates an AltStore/SideStore compatible manifest from GitHub Releases.
//
// Reads all releases (tagged and pre-release) and their IPA assets, then
// writes a JSON manifest suitable for importing into AltStore, SideStore,
// AltHub, or any compatible sideloading client.
//
// Usage:
//   node scripts/generate-altstore-manifest.mjs [--output <path>]
//
// Requires:
//   - gh CLI authenticated (or GITHUB_TOKEN set)
//   - Repository: TempleOfSats/Robosats-Experimental

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REPO = "TempleOfSats/Robosats-Experimental";
const ICON_URL = `https://raw.githubusercontent.com/${REPO}/main/ios/RoboSatsExp/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`;

const SOURCE_NAME = "RoboSats Exp.";
const SOURCE_URL = `https://TempleOfSats.github.io/Robosats-Experimental/altstore.json`;
const WEBSITE = "https://robosats.com";
const BUNDLE_ID = "com.robosats.exp.ios";
const DEVELOPER = "RoboSats";
const MIN_OS_VERSION = "16.0";

function log(...args) {
  console.log("[manifest]", ...args);
}

function runCmd(cmd, ...args) {
  return execFileSync(cmd, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function main() {
  const args = process.argv.slice(2);
  let outputPath = resolve(ROOT, "altstore.json");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = resolve(ROOT, args[++i]);
    }
  }

  log("Fetching releases from GitHub...");

  const releases = JSON.parse(
    runCmd("gh", "release", "list", "--json", "tagName,name,isPrerelease,publishedAt", "--limit", "100")
  );

  // Fetch body and assets for each release
  for (const release of releases) {
    const fullRelease = JSON.parse(
      runCmd("gh", "release", "view", release.tagName, "--json", "body,assets")
    );
    release.body = fullRelease.body;
    release.assetList = (fullRelease.assets || []).map((a) => ({
      name: a.name,
      browser_download_url: a.browser_download_url,
      size: a.size,
    }));
  }

  if (releases.length === 0) {
    log("No releases found.");
    process.exit(0);
  }

  log(`Found ${releases.length} release(s).`);

  const apps = [];

  for (const release of releases) {
    const ipaAssets = (release.assetList || []).filter((a) => a.name.endsWith(".ipa"));

    if (ipaAssets.length === 0) continue;

    const versions = ipaAssets.map((asset, idx) => ({
      version: release.tagName.replace(/^v/, ""),
      buildVersion: String(idx + 1),
      date: release.publishedAt.split("T")[0],
      localizedDescription: release.body
        ? release.body
            .split("\n")
            .filter((l) => l.trim() && !l.startsWith("#"))
            .join("\n")
            .trim()
        : "Update.",
      downloadURL: asset.browser_download_url,
      size: asset.size,
      minOSVersion: MIN_OS_VERSION,
    }));

    // Sort: newest first
    versions.sort((a, b) => new Date(b.date) - new Date(a.date));

    apps.push({
      name: SOURCE_NAME,
      bundleIdentifier: BUNDLE_ID,
      developerName: DEVELOPER,
      subtitle: "Peer-to-peer Bitcoin wallet",
      localizedDescription:
        "RoboSats is a peer-to-peer Bitcoin wallet with built-in Tor routing.\n\n" +
        "Features:\n" +
        "• Privacy-first P2P trading\n" +
        "• Built-in Tor (Arti) for coordinator traffic\n" +
        "• Encrypted trade chat via Nostr\n" +
        "• Open source (AGPLv3)",
      iconURL: ICON_URL,
      tintColor: "FF6600",
      minOSVersion: MIN_OS_VERSION,
      versions,
    });
  }

  if (apps.length === 0) {
    log("No IPA assets found in any release.");
    process.exit(0);
  }

  const manifest = {
    name: SOURCE_NAME,
    sourceURL: SOURCE_URL,
    iconURL: ICON_URL,
    website: WEBSITE,
    subtitle: "Sideload RoboSats Exp. directly on your device",
    apps,
  };

  writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n");
  const totalVersions = apps.reduce((s, a) => s + a.versions.length, 0);
  log(`Manifest written to ${outputPath}`);
  log(`  ${apps.length} app(s), ${totalVersions} version(s) total`);
}

main().catch((err) => {
  console.error("[manifest] Error:", err.message);
  process.exit(1);
});
