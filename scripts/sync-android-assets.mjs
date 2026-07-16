import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "dist");
const target = resolve(root, "android/app/src/main/assets");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

const indexPath = resolve(target, "index.html");
const indexHtml = await readFile(indexPath, "utf8");
const inlineScriptHashes = [...indexHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim())
  .map((script) => `'sha256-${createHash("sha256").update(script).digest("base64")}'`);
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${inlineScriptHashes.join(" ")}`.trim(),
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'"
].join("; ");
const hardenedIndexHtml = indexHtml.replace(
  /<head>/i,
  `<head>\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`
);
await writeFile(indexPath, hardenedIndexHtml);

console.log(`Android web assets synced: ${source} -> ${target}`);
