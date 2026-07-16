import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const sourcePath = fileURLToPath(new URL("./src", import.meta.url));
const openPgpLightweightPath = fileURLToPath(
  new URL("./node_modules/openpgp/dist/lightweight/openpgp.min.mjs", import.meta.url)
);
const tradePreviewFixturesPath = fileURLToPath(
  new URL("./src/domains/orders/tradePreviewFixtures.ts", import.meta.url)
);
const disabledTradePreviewFixturesPath = fileURLToPath(
  new URL("./src/dev/tradePreviewFixtures.disabled.ts", import.meta.url)
);

export default defineConfig(({ command }) => {
  const tradeLabEnabled = command === "serve" || process.env.VITE_ENABLE_TRADE_LAB === "true";
  const assetDirectory = command === "build" ? `assets/${buildRevision()}` : "assets";

  return {
    server: {
      allowedHosts: true
    },
    plugins: [wasm(), react()],
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
      modulePreload: true,
      outDir: "dist",
      sourcemap: false,
      target: "esnext",
      rolldownOptions: {
        output: {
          entryFileNames: `${assetDirectory}/robosats-exp.[name].[hash].js`,
          chunkFileNames: `${assetDirectory}/robosats-exp.[name].[hash].js`,
          assetFileNames: `${assetDirectory}/robosats-exp.[name].[hash].[ext]`,
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, "/");
            if (normalizedId.includes("vite/preload-helper")) return "preload-helper";
            if (!normalizedId.includes("node_modules")) return undefined;
            if (normalizedId.includes("openpgp")) return "openpgp";
            if (normalizedId.includes("nostr-tools") || normalizedId.includes("@noble") || normalizedId.includes("@scure")) return "nostr";
            if (normalizedId.includes("qrcode.react")) return "qrcode";
            if (normalizedId.includes("robo-identities-wasm")) return "robot-identity";
            // Avoid a dependency waterfall on Tor-served HTTP/1.1 pages.
            return undefined;
          }
        }
      }
    }
  };
});

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
