import { spawnSync } from "node:child_process";

const executable = process.platform === "win32" ? "node_modules/.bin/depcruise.cmd" : "node_modules/.bin/depcruise";
const result = spawnSync(executable, ["--config", ".dependency-cruiser.cjs", "--output-type", "json", "src"], {
  encoding: "utf8",
  shell: false
});

if (result.error) {
  console.error(`Unable to run dependency-cruiser: ${result.error.message}`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  console.error("dependency-cruiser did not return valid JSON.");
  process.exit(2);
}

const summary = report.summary ?? {};
const transpilers = summary.environment?.transpilersFound ?? [];
const extensions = summary.environment?.extensionsFound ?? [];
const swcAvailable = transpilers.some((item) => item.name === "swc" && item.available);
const typescriptExtensionsAvailable = [".ts", ".tsx"].every((extension) =>
  extensions.some((item) => item.extension === extension && item.available)
);
const expectedEntryPoint = report.modules?.some((module) => module.source === "src/main.tsx");

if (!swcAvailable || !typescriptExtensionsAvailable || !expectedEntryPoint || summary.totalDependenciesCruised < 1) {
  console.error(
    "Dependency analysis was incomplete. SWC, TypeScript/TSX parsing, the main entry point, and a non-empty graph are required."
  );
  process.exit(2);
}

const unexpectedEnvironmentIssues = (summary.environment?.issues ?? []).filter(
  (issue) => issue.name !== "missing-typescript-transpiler"
);
if (unexpectedEnvironmentIssues.length > 0) {
  console.error("Dependency analysis reported environment problems:");
  for (const issue of unexpectedEnvironmentIssues) {
    console.error(`  - ${issue.name}: ${issue.description}`);
  }
  process.exit(2);
}

const violations = summary.violations ?? [];
if (violations.length > 0) {
  console.error("Dependency-boundary violations:");
  for (const violation of violations) {
    const cycle = violation.cycle?.length ? ` (${violation.cycle.join(" -> ")})` : "";
    console.error(`  - ${violation.rule?.name ?? "unknown"}: ${violation.from} -> ${violation.to}${cycle}`);
  }
  process.exit(1);
}

console.log(
  `Dependency boundaries passed: ${summary.totalCruised} modules and ${summary.totalDependenciesCruised} imports checked with SWC.`
);
