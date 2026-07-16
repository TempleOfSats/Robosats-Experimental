#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const iosRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(iosRoot, "..");
const source = resolve(appRoot, "dist");
const target = resolve(iosRoot, "RoboSatsExp/Resources/WebApp");

await rm(target, { force: true, recursive: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
await writeFile(resolve(target, ".gitkeep"), "");
console.log(`iOS web assets synced: ${source} -> ${target}`);
