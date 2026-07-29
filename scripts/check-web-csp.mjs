import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const [html, headers] = await Promise.all([
  readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  readFile(new URL("../nodeapp/security-headers.conf", import.meta.url), "utf8")
]);

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (inlineScripts.length === 0) throw new Error("The production build has no inline scripts to validate.");

const missing = inlineScripts
  .map((match) => `sha256-${createHash("sha256").update(match[1]).digest("base64")}`)
  .filter((hash) => !headers.includes(`'${hash}'`));

if (missing.length > 0) {
  throw new Error(`The web CSP is missing inline-script hashes:\n${missing.join("\n")}`);
}

if (!headers.includes("object-src 'none'") || !headers.includes("frame-ancestors 'none'")) {
  throw new Error("The web CSP is missing required object or framing restrictions.");
}

console.log(`Web CSP covers ${inlineScripts.length} inline boot scripts.`);
