import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SECURITY_HEADERS_INCLUDE = "/etc/nginx/security-headers.conf";
const deployableConfigs = [
  ["direct deployment", new URL("../deploy/nginx.conf", import.meta.url)],
  ["node app", new URL("../nodeapp/nginx.conf", import.meta.url)]
];
const [html, headers, ...nginxConfigs] = await Promise.all([
  readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  readFile(new URL("../nodeapp/security-headers.conf", import.meta.url), "utf8"),
  ...deployableConfigs.map(([, url]) => readFile(url, "utf8"))
]);

const headerDirectives = headers
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
const cspDirectives = headerDirectives.filter((line) => /^add_header\s+Content-Security-Policy\b/.test(line));
const cspMatch = cspDirectives[0]?.match(/^add_header\s+Content-Security-Policy\s+"(.+)"\s+always;$/);
if (cspDirectives.length !== 1 || !cspMatch) {
  throw new Error("The shared web security policy must contain one active CSP header with always enabled.");
}
const cspPolicy = cspMatch[1];
const scriptSources = cspPolicy.split(";").find((directive) => directive.trim().startsWith("script-src ")) ?? "";

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (inlineScripts.length === 0) throw new Error("The production build has no inline scripts to validate.");

const missing = inlineScripts
  .map((match) => `sha256-${createHash("sha256").update(match[1]).digest("base64")}`)
  .filter((hash) => !scriptSources.includes(`'${hash}'`));

if (missing.length > 0) {
  throw new Error(`The web CSP is missing inline-script hashes:\n${missing.join("\n")}`);
}

const requiredCspDirectives = ["object-src 'none'", "frame-ancestors 'none'"];
const missingCspDirectives = requiredCspDirectives.filter((directive) => !cspPolicy.includes(directive));
if (missingCspDirectives.length > 0) {
  throw new Error(`The shared web CSP is incomplete:\n${missingCspDirectives.join("\n")}`);
}

const requiredHeaders = new Map([
  ["X-Content-Type-Options", "add_header X-Content-Type-Options nosniff always;"],
  ["X-Frame-Options", "add_header X-Frame-Options DENY always;"],
  ["Referrer-Policy", "add_header Referrer-Policy no-referrer always;"],
  ["Permissions-Policy", 'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;']
]);
const invalidHeaders = [...requiredHeaders].filter(([name, directive]) => {
  const active = headerDirectives.filter((line) => new RegExp(`^add_header\\s+${name}\\b`).test(line));
  return active.length !== 1 || active[0] !== directive;
});
if (invalidHeaders.length > 0) {
  throw new Error(
    `The shared web security policy must contain exactly one canonical directive for:\n${invalidHeaders
      .map(([name]) => name)
      .join("\n")}`
  );
}

for (const [index, [name]] of deployableConfigs.entries()) {
  verifySecurityHeaderIncludes(name, nginxConfigs[index]);
}

console.log(
  `Web CSP covers ${inlineScripts.length} inline boot scripts across ${deployableConfigs.length} deployable Nginx configs.`
);

function verifySecurityHeaderIncludes(name, source) {
  const lines = source.split(/\r?\n/);
  const serverLines = directiveLines(lines, /^\s*server\s*\{\s*$/);
  const locationStarts = directiveLines(lines, /^\s*location\b/);
  const locationLines = directiveLines(lines, /^\s*location\b.*\{\s*$/);
  const duplicatedSecurityHeaders = [
    "Content-Security-Policy",
    "Permissions-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options"
  ].filter((header) => new RegExp(`^\\s*add_header\\s+${header}\\b`, "m").test(source));

  if (serverLines.length !== 1) {
    throw new Error(`The ${name} Nginx config must contain exactly one server block.`);
  }
  if (duplicatedSecurityHeaders.length > 0) {
    throw new Error(
      `The ${name} Nginx config duplicates shared security headers: ${duplicatedSecurityHeaders.join(", ")}`
    );
  }
  if (locationStarts.length !== locationLines.length) {
    throw new Error(`The ${name} Nginx config has an unsupported multi-line location declaration.`);
  }

  const include = `include ${SECURITY_HEADERS_INCLUDE};`;
  const firstLocation = locationLines[0] ?? lines.length;
  if (!lines.slice(serverLines[0] + 1, firstLocation).some((line) => line.trim() === include)) {
    throw new Error(`The ${name} Nginx server block does not include the shared security headers.`);
  }

  const missingLocations = locationLines
    .filter((lineNumber) => nextDirective(lines, lineNumber + 1) !== include)
    .map((lineNumber) => lineNumber + 1);
  if (missingLocations.length > 0) {
    throw new Error(
      `The ${name} Nginx config omits shared security headers from location lines: ${missingLocations.join(", ")}`
    );
  }
}

function directiveLines(lines, pattern) {
  return lines.flatMap((line, index) => (pattern.test(line) ? [index] : []));
}

function nextDirective(lines, start) {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line && !line.startsWith("#")) return line;
  }
  return "";
}
