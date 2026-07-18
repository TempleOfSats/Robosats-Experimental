#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packages = [
  {
    label: "Android universal APK",
    matches: (filename) => filename.endsWith("-universal.apk")
  },
  {
    label: "iOS unsigned IPA",
    matches: (filename) => filename.endsWith("-unsigned.ipa")
  },
  {
    label: "Linux AppImage",
    matches: (filename) => filename.endsWith(".AppImage")
  },
  {
    label: "Windows installer",
    matches: (filename) => filename.endsWith(".exe")
  },
  {
    label: "macOS DMG",
    matches: (filename) => filename.endsWith(".dmg")
  }
];

export function releaseDownloadSection(filenames, serverUrl, repository, tag) {
  const origin = new URL(serverUrl).origin;
  if (!/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  if (!tag) {
    throw new Error("Release tag is required");
  }

  const links = packages.map(({ label, matches }) => {
    const matchesForPackage = filenames.filter(matches);
    if (matchesForPackage.length !== 1) {
      throw new Error(
        `Expected one ${label} artifact, found ${matchesForPackage.length}`
      );
    }

    const filename = matchesForPackage[0];
    const url = [
      origin,
      repository,
      "releases/download",
      encodeURIComponent(tag),
      encodeURIComponent(filename)
    ].join("/");
    return `* [${label}](${url})`;
  });

  return [
    "## Downloads",
    "",
    ...links,
    "",
    "Detached signatures and checksums are available in the release assets."
  ].join("\n");
}

async function main() {
  const [assetsDirectory, serverUrl, repository, tag, ...extraArguments] =
    process.argv.slice(2);
  if (!assetsDirectory || !serverUrl || !repository || !tag || extraArguments.length) {
    throw new Error(
      "Usage: release-downloads.mjs <assets-directory> <server-url> <repository> <tag>"
    );
  }

  const filenames = await readdir(assetsDirectory);
  process.stdout.write(`${releaseDownloadSection(filenames, serverUrl, repository, tag)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
