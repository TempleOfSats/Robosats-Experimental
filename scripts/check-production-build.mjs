#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const distRoot = resolve("dist");
const forbiddenNames = /(?:TradeLab|tradePreviewFixtures)/i;
const forbiddenContent = /__dev\/trade-lab/;
const indexHtml = await readFile(resolve(distRoot, "index.html"), "utf8");
const files = await listFiles(distRoot);
const staticMatch = indexHtml.match(/["'(]\/static\/([0-9a-f]{16})\//);

if (!/["']\/assets\/[^/"']+\/robosats-exp\.[^"']+\.js["']/.test(indexHtml)) {
  throw new Error("Production entry assets must be namespaced by build revision.");
}
if (/rel=["']modulepreload["']/.test(indexHtml)) {
  throw new Error("Production HTML must not eagerly preload route and cryptography chunks.");
}
if (!/<link\b(?=[^>]*\brel=["']preload["'])(?=[^>]*\bas=["']style["'])(?=[^>]*\bdata-robosats-app-style\b)[^>]*>/.test(indexHtml)) {
  throw new Error("Production application styles must preload behind the inline loading screen.");
}
if (/<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*robosats-exp\.index\.)[^>]*>/.test(indexHtml)) {
  throw new Error("Production application styles must not block the inline loading screen.");
}
if (!staticMatch) {
  throw new Error("Production static assets must use a content-hashed namespace.");
}

const staticRevision = staticMatch[1];
await stat(resolve(distRoot, "static", staticRevision));
const entryMatch = indexHtml.match(/src=["'](\/assets\/[^"']+\/robosats-exp\.index\.[^"']+\.js)["']/);
if (!entryMatch) throw new Error("Could not locate the production entry module.");
const entryPath = resolve(distRoot, entryMatch[1].slice(1));
const initialGraph = await staticImportGraph(entryPath);
await assertAcyclicStaticImports(files.filter((path) => path.endsWith(".js")));
if (initialGraph.size > 6) {
  throw new Error(`Initial JavaScript request graph exceeds its budget: ${initialGraph.size} files`);
}
if ([...initialGraph].some((path) => /openpgp|roboidentitiesClient|F2FLocationDialog/.test(path))) {
  throw new Error("OpenPGP, map, and robot-generation code must remain lazy-loaded.");
}

const routeBudgets = [
  ["RobotGaragePage", 20],
  ["OffersPage", 20],
  ["SettingsPage", 12],
  ["ProWorkspacePage", 36],
  ["CreateOrderPage", 20]
];
const routeGraphCounts = [];
for (const [name, budget] of routeBudgets) {
  const routePath = files.find((path) => basename(path).includes(`.${name}.`) && path.endsWith(".js"));
  if (!routePath) throw new Error(`Could not locate the ${name} production chunk.`);
  const routeGraph = await staticImportGraph(routePath);
  const additionalRequests = [...routeGraph].filter((path) => !initialGraph.has(path)).length;
  if (additionalRequests > budget) {
    throw new Error(`${name} JavaScript request graph exceeds its budget: ${additionalRequests} files`);
  }
  routeGraphCounts.push(`${name} ${additionalRequests}`);
}

for (const path of files) {
  if (forbiddenNames.test(path)) {
    throw new Error(`Development-only module emitted in production build: ${path}`);
  }
  if (path.endsWith(".wasm")) {
    throw new Error(`Unexpected WebAssembly emitted in production build: ${path}`);
  }

  if (/\.(?:asc|css|html|js|json|mjs|svg|txt|xml)$/.test(path)) {
    const content = await readFile(path, "utf8");
    if (forbiddenContent.test(content)) {
      throw new Error(`Development-only route emitted in production build: ${path}`);
    }
    if (/["'`]\/static(?:["'`]|\/(?![0-9a-f]{16}\/))/.test(content)) {
      throw new Error(`Unversioned static asset URL emitted in production build: ${path}`);
    }
  }
}

const sourceFiles = files.filter((path) => !path.endsWith(".br") && !path.endsWith(".gz"));
const compressedSources = [];
for (const path of sourceFiles) {
  if (!/\.(?:asc|css|html|js|json|mjs|svg|txt|wasm|xml)$/i.test(path)) continue;
  if ((await stat(path)).size < 1024) continue;
  await Promise.all([stat(`${path}.br`), stat(`${path}.gz`)]);
  compressedSources.push(path);
}
if (compressedSources.length === 0) {
  throw new Error("Production build did not emit any precompressed representations.");
}

const identityFiles = sourceFiles.filter((path) => /roboidentitiesClient|robot-identities/.test(path));
const identityTransferBytes = identityFiles.reduce((total, path) => {
  const content = readFileSync(path);
  return total + (path.endsWith(".js") ? gzipSync(content, { level: 9 }).length : content.length);
}, 0);
if (identityFiles.length !== 2 || identityTransferBytes > 230_000) {
  throw new Error(`Browser identity payload exceeds its budget: ${identityTransferBytes} bytes`);
}

console.log(
  `Production bundle excludes the Trade Lab and identity WASM, versions static assets as ${staticRevision}, ` +
    `precompresses ${compressedSources.length} files (${identityTransferBytes} byte identity payload), ` +
    `and limits JavaScript requests to ${initialGraph.size} initially (${routeGraphCounts.join(", ")} additional).`
);

async function staticImportGraph(entryPath) {
  const graph = new Set();
  const pending = [entryPath];

  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || graph.has(path)) continue;
    graph.add(path);
    pending.push(...(await staticImports(path)));
  }

  return graph;
}

async function assertAcyclicStaticImports(paths) {
  const emittedPaths = new Set(paths);
  const state = new Map();
  const stack = [];

  async function visit(path) {
    if (state.get(path) === "visited") return;
    if (state.get(path) === "visiting") {
      const cycleStart = stack.indexOf(path);
      const cycle = [...stack.slice(cycleStart), path].map(basename).join(" -> ");
      throw new Error(`Circular static JavaScript dependency emitted in production build: ${cycle}`);
    }

    state.set(path, "visiting");
    stack.push(path);
    for (const dependency of await staticImports(path)) {
      if (emittedPaths.has(dependency)) await visit(dependency);
    }
    stack.pop();
    state.set(path, "visited");
  }

  for (const path of paths) await visit(path);
}

async function staticImports(path) {
  const content = await readFile(path, "utf8");
  const specifiers = [
    ...content.matchAll(/\bfrom\s*["'](\.\/[^"']+\.js)["']/g),
    ...content.matchAll(/\bimport\s*["'](\.\/[^"']+\.js)["']/g)
  ].map((match) => match[1]);
  return specifiers.map((specifier) => resolve(dirname(path), specifier));
}

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
