#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

export function releaseMetadata(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported release version: ${version}`);
  }

  const [, majorText, minorText, patchText, channel, sequenceText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  const sequence = sequenceText ? Number(sequenceText) : 0;
  if (major > 20 || minor > 99 || patch > 99 || sequence > 999) {
    throw new Error(`Release version exceeds the mobile version-code range: ${version}`);
  }

  const channelOffset = channel === "alpha"
    ? 1_000
    : channel === "beta"
      ? 4_000
      : channel === "rc"
        ? 7_000
        : 9_999;

  return {
    version,
    ios_version: `${major}.${minor}.${patch}`,
    build_number: String((major * 100_000_000) + (minor * 1_000_000) + (patch * 10_000) + channelOffset + sequence),
    prerelease: String(Boolean(channel))
  };
}

function packageVersion() {
  const source = readFileSync(`${appRoot}/package.json`, "utf8");
  return JSON.parse(source).version;
}

function main() {
  const { requestedValue, tag } = parseArguments(process.argv.slice(2));
  const version = packageVersion();

  if (tag && tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} does not match package version v${version}`);
  }

  const metadata = releaseMetadata(version);
  if (requestedValue) {
    if (!(requestedValue in metadata)) throw new Error(`Unknown release metadata field: ${requestedValue}`);
    console.log(metadata[requestedValue]);
    return;
  }

  for (const [key, value] of Object.entries(metadata)) console.log(`${key}=${value}`);
}

export function parseArguments(args) {
  let requestedValue;
  let tag;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--value") {
      requestedValue = args[index + 1];
      if (!requestedValue || requestedValue.startsWith("--")) {
        throw new Error("--value requires a metadata field");
      }
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (tag) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    tag = argument;
  }

  return { requestedValue, tag };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
