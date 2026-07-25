import { spawnSync } from "node:child_process";

const severityOrder = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const requestedLevel = process.argv[2] ?? "high";
if (!(requestedLevel in severityOrder)) {
  console.error(`Unknown audit level: ${requestedLevel}`);
  process.exit(2);
}

// The app uses React Router only as a client-side SPA router. It does not use
// RSC mode, actions, server actions, data routers, SSR, or prerendering. No
// patched React Router release exists yet; remove this exception once npm no
// longer reports the advisory for the locked dependency graph.
const temporaryAllowlist = new Map([
  [
    "GHSA-qwww-vcr4-c8h2",
    "React Router RSC-mode CSRF is unreachable in this client-only SPA",
  ],
]);

const audit = spawnSync("npm", ["audit", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (audit.error) {
  console.error(`Unable to run npm audit: ${audit.error.message}`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stderr);
  process.stderr.write(audit.stdout);
  console.error("npm audit did not return valid JSON.");
  process.exit(2);
}

const vulnerabilities = report.vulnerabilities ?? {};
const advisoryId = (url) => url?.match(/GHSA-[\w-]+$/)?.[0] ?? url;
const advisoriesFor = (name, visited = new Set()) => {
  if (visited.has(name)) return [];
  visited.add(name);

  return (vulnerabilities[name]?.via ?? []).flatMap((entry) => {
    if (typeof entry === "string") return advisoriesFor(entry, visited);
    return [entry];
  });
};

const threshold = severityOrder[requestedLevel];
const blocking = [];
const allowed = new Map();

for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if ((severityOrder[vulnerability.severity] ?? -1) < threshold) continue;

  const advisories = advisoriesFor(name);
  const disallowed = advisories.filter(
    (advisory) => !temporaryAllowlist.has(advisoryId(advisory.url)),
  );

  if (advisories.length === 0 || disallowed.length > 0) {
    blocking.push({ name, severity: vulnerability.severity, advisories: disallowed });
    continue;
  }

  for (const advisory of advisories) {
    const id = advisoryId(advisory.url);
    allowed.set(id, temporaryAllowlist.get(id));
  }
}

for (const [id, reason] of temporaryAllowlist) {
  if (!allowed.has(id)) {
    console.error(
      `Temporary audit exception ${id} is no longer needed. Remove it from scripts/audit-dependencies.mjs.`,
    );
    process.exit(1);
  }
  console.warn(`Temporarily allowing ${id}: ${reason}.`);
}

if (blocking.length > 0) {
  for (const vulnerability of blocking) {
    console.error(`${vulnerability.severity}: ${vulnerability.name}`);
    for (const advisory of vulnerability.advisories) {
      console.error(`  ${advisoryId(advisory.url)} ${advisory.title}`);
    }
  }
  process.exit(1);
}

console.log(`Dependency audit passed at severity level ${requestedLevel}.`);
