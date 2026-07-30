import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const baseline = JSON.parse(readFileSync(new URL("./complexity-baseline.json", import.meta.url), "utf8"));
const oxlint = process.platform === "win32" ? "node_modules/.bin/oxlint.cmd" : "node_modules/.bin/oxlint";
const result = spawnSync(oxlint, ["src", "-D", "complexity", "-f", "json"], {
  encoding: "utf8",
  shell: false
});

if (result.error) {
  console.error(`Unable to run Oxlint complexity analysis: ${result.error.message}`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  console.error("Oxlint did not return valid JSON.");
  process.exit(2);
}

const current = new Map();
const failures = [];

for (const diagnostic of report.diagnostics ?? []) {
  if (diagnostic.code !== "eslint(complexity)") continue;
  const match = diagnostic.message.match(/(?:async )?function `([^`]+)` has a complexity of (\d+)/);
  if (!match) {
    failures.push(`Could not parse complexity diagnostic: ${diagnostic.message}`);
    continue;
  }

  const key = `${diagnostic.filename}#${match[1]}`;
  const value = Number(match[2]);
  current.set(key, value);
  const allowed = baseline[key];

  if (allowed === undefined) {
    failures.push(`${key} has new complexity ${value}; keep new functions at 20 or below.`);
  } else if (value > allowed) {
    failures.push(`${key} increased from ${allowed} to ${value}.`);
  } else if (value < allowed) {
    failures.push(`${key} improved from ${allowed} to ${value}; lower its baseline to preserve the gain.`);
  }
}

for (const key of Object.keys(baseline)) {
  if (!current.has(key)) {
    failures.push(`${key} is now at 20 or below, renamed, or removed; delete its obsolete baseline entry.`);
  }
}

if (failures.length > 0) {
  console.error("Complexity ratchet failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Complexity check passed: new functions are capped at 20 and ${current.size} existing exceptions did not grow.`
);
