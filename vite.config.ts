import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const sourcePath = fileURLToPath(new URL("./src", import.meta.url));
const publicStaticPath = fileURLToPath(new URL("./public/static", import.meta.url));
const distStaticPath = fileURLToPath(new URL("./dist/static", import.meta.url));
const openPgpLightweightPath = fileURLToPath(
  new URL("./node_modules/openpgp/dist/lightweight/openpgp.min.mjs", import.meta.url)
);
const tradePreviewFixturesPath = fileURLToPath(
  new URL("./src/domains/orders/tradePreviewFixtures.ts", import.meta.url)
);
const disabledTradePreviewFixturesPath = fileURLToPath(
  new URL("./src/dev/tradePreviewFixtures.disabled.ts", import.meta.url)
);

export default defineConfig(({ command, mode }) => {
  const tradeLabEnabled = command === "serve" || process.env.VITE_ENABLE_TRADE_LAB === "true";
  const assetDirectory = command === "build" ? `assets/${buildRevision()}` : "assets";
  // Installed bundles are immutable and retain browser storage across upgrades.
  // Stable URLs avoid platform-specific Tauri protocol resolution and stale cached revision paths.
  const versionStatic = command === "build" && mode !== "desktop";
  const staticRevision = versionStatic ? staticTreeRevision(publicStaticPath) : "";

  return {
    server: {
      allowedHosts: true
    },
    plugins: [
      react(),
      ...(versionStatic ? [versionStaticAssets(staticRevision)] : []),
      ...(command === "build" ? [deferApplicationStyles()] : [])
    ],
    resolve: {
      alias: [
        {
          find: "@/domains/orders/tradePreviewFixtures",
          replacement: tradeLabEnabled ? tradePreviewFixturesPath : disabledTradePreviewFixturesPath
        },
        { find: "openpgp/lightweight", replacement: openPgpLightweightPath },
        { find: "@", replacement: sourcePath }
      ]
    },
    build: {
      chunkSizeWarningLimit: 750,
      // Keep first paint free from eager route/crypto fetches. Once a lazy
      // route is requested, preload its shared dependencies in parallel to
      // avoid serial request waterfalls over Tor.
      modulePreload: {
        polyfill: true,
        resolveDependencies: (_filename, dependencies, context) =>
          context.hostType === "html" ? [] : dependencies
      },
      outDir: "dist",
      sourcemap: false,
      target: "esnext",
      rolldownOptions: {
        output: {
          entryFileNames: `${assetDirectory}/robosats-exp.[name].[hash].js`,
          chunkFileNames: `${assetDirectory}/robosats-exp.[name].[hash].js`,
          assetFileNames: `${assetDirectory}/robosats-exp.[name].[hash].[ext]`,
          codeSplitting: {
            // Tor request latency is more expensive than a few unused kilobytes.
            // Merge tiny shared fragments while retaining route and crypto
            // boundaries for code that is genuinely expensive.
            minSize: 32_000,
            groups: [
              {
                name: "preload-helper",
                test: /vite[\\/]preload-helper/,
                priority: 40,
                minSize: 0,
                includeDependenciesRecursively: false
              },
              {
                name: "nostr",
                test: /node_modules[\\/](?:nostr-tools|@noble|@scure)[\\/]/,
                priority: 40,
                minSize: 0
              },
              {
                name: "qrcode",
                test: /node_modules[\\/]qrcode\.react[\\/]/,
                priority: 40,
                minSize: 0,
                includeDependenciesRecursively: false
              },
              {
                name: "initial",
                tags: ["$initial"],
                priority: 30,
                minSize: 0
              },
              {
                name: "route-icons",
                test: /node_modules[\\/]lucide-react[\\/]/,
                priority: 20,
                minSize: 0,
                includeDependenciesRecursively: false
              }
            ]
          }
        }
      }
    }
  };
});

function versionStaticAssets(revision: string) {
  const versionedPrefix = `/static/${revision}/`;

  return {
    name: "robosats-version-static-assets",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.startsWith(sourcePath) || !code.includes("/static/")) return null;
      return {
        code: replaceStaticPrefix(code, versionedPrefix),
        map: null
      };
    },
    transformIndexHtml(html: string) {
      return replaceStaticPrefix(html, versionedPrefix);
    },
    closeBundle() {
      if (!statExists(distStaticPath)) return;

      const unversionedPath = `${distStaticPath}.unversioned`;
      rmSync(unversionedPath, { force: true, recursive: true });
      renameSync(distStaticPath, unversionedPath);
      mkdirSync(distStaticPath, { recursive: true });
      const versionedPath = resolve(distStaticPath, revision);
      renameSync(unversionedPath, versionedPath);
      rewriteStaticTextFiles(versionedPath, versionedPrefix);
    }
  };
}

function deferApplicationStyles() {
  return {
    name: "robosats-defer-application-styles",
    transformIndexHtml: {
      order: "post" as const,
      handler(html: string) {
        return html.replace(/<link\b([^>]*\brel="stylesheet"[^>]*)>/g, (tag, attributes: string) => {
          if (!/\bhref="\/assets\/[^"]+\/robosats-exp\.index\.[^"]+\.css"/.test(attributes)) return tag;
          const deferredAttributes = attributes.replace(/\s*\brel="stylesheet"/, "");
          return `<link rel="preload" as="style" data-robosats-app-style${deferredAttributes}>`;
        });
      }
    }
  };
}

function buildRevision(): string {
  const configured = process.env.ROBOSATS_BUILD_REVISION ?? process.env.GITHUB_SHA;
  if (configured) return normalizeRevision(configured);

  try {
    return normalizeRevision(execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }));
  } catch {
    return normalizeRevision(process.env.npm_package_version ?? "development");
  }
}

function normalizeRevision(value: string): string {
  return value.trim().slice(0, 40).replace(/[^a-zA-Z0-9._-]/g, "-") || "development";
}

function staticTreeRevision(root: string): string {
  const hash = createHash("sha256");
  for (const path of listFiles(root)) {
    hash.update(relative(root, path).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

function rewriteStaticTextFiles(root: string, versionedPrefix: string): void {
  const textFile = /\.(?:asc|css|html|js|json|mjs|svg|txt|xml)$/i;
  for (const path of listFiles(root)) {
    if (!textFile.test(path)) continue;
    const content = readFileSync(path, "utf8");
    const rewritten = replaceStaticPrefix(content, versionedPrefix);
    if (rewritten !== content) writeFileSync(path, rewritten);
  }
}

function replaceStaticPrefix(content: string, versionedPrefix: string): string {
  return content.replace(/\/static\//g, versionedPrefix);
}

function listFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(root, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    })
    .sort();
}

function statExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
