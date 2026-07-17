#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseMetadata } from "../../scripts/release-metadata.mjs";

const iosRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [project, xtool, plist, packageSource] = await Promise.all([
  readFile(resolve(iosRoot, "project.yml"), "utf8"),
  readFile(resolve(iosRoot, "xtool.yml"), "utf8"),
  readFile(resolve(iosRoot, "Config/Info.xtool.plist"), "utf8"),
  readFile(resolve(iosRoot, "../package.json"), "utf8")
]);

const metadata = releaseMetadata(JSON.parse(packageSource).version);

const projectBundleID = yamlValue(project, "PRODUCT_BUNDLE_IDENTIFIER");
const projectVersion = yamlValue(project, "MARKETING_VERSION");
const projectBuild = yamlValue(project, "CURRENT_PROJECT_VERSION");
const xtoolBundleID = yamlValue(xtool, "bundleID");
const xtoolVersion = plistValue(plist, "CFBundleShortVersionString");
const xtoolBuild = plistValue(plist, "CFBundleVersion");

assertEqual("bundle ID", projectBundleID, xtoolBundleID);
assertEqual("marketing version", projectVersion, xtoolVersion);
assertEqual("build number", projectBuild, xtoolBuild);
assertEqual("package marketing version", projectVersion, metadata.ios_version);
assertEqual("package build number", projectBuild, metadata.build_number);
assertMatch(
  "Xcode WebApp resource",
  project,
  /-\s+path:\s+RoboSatsExp\/Resources\/WebApp\s+type:\s+folder\s+buildPhase:\s+resources/
);
assertMatch(
  "Xcode loading mark resource",
  project,
  /-\s+path:\s+RoboSatsExp\/Resources\/Raw\/RoboSatsMark\.png\s+buildPhase:\s+resources/
);

console.log(`iOS build configuration: ${projectBundleID} ${projectVersion} (${projectBuild})`);

function yamlValue(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\s]+)["']?\\s*$`, "m"));
  if (!match) throw new Error(`Missing ${key}`);
  return match[1];
}

function plistValue(source, key) {
  const match = source.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
  if (!match) throw new Error(`Missing ${key}`);
  return match[1].trim();
}

function assertEqual(label, xcodeValue, xtoolValue) {
  if (xcodeValue !== xtoolValue) {
    throw new Error(`iOS ${label} differs: Xcode uses ${xcodeValue}, xtool uses ${xtoolValue}`);
  }
}

function assertMatch(label, source, pattern) {
  if (!pattern.test(source)) {
    throw new Error(`Missing or invalid ${label} declaration`);
  }
}
