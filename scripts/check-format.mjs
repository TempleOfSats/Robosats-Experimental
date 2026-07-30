import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { format, getFileInfo, resolveConfig } from "prettier";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const supported = new Set([
  ".css",
  ".cjs",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml"
]);
const write = process.argv.includes("--write");
const changeSet = changedFiles();
const eligible = [];
const skippedLegacy = [];

for (const path of changeSet.files) {
  if (!supported.has(extension(path))) continue;
  const fileInfo = await getFileInfo(path, { ignorePath: ".prettierignore" });
  if (fileInfo.ignored || !fileInfo.inferredParser) continue;

  const previous = gitText(["show", `${changeSet.base}:${path}`]);
  if (previous !== undefined && !(await isFormatted(path, previous))) {
    skippedLegacy.push(path);
    continue;
  }
  eligible.push(path);
}

if (eligible.length === 0) {
  console.log("No new or baseline-formatted files need a Prettier check.");
  reportSkippedLegacy();
  process.exit(0);
}

const unformatted = [];
for (const path of eligible) {
  const current = readFileSync(path, "utf8");
  const formatted = await formattedSource(path, current);
  if (current === formatted) continue;
  if (write) {
    writeFileSync(path, formatted);
    console.log(`Formatted ${path}`);
  } else {
    unformatted.push(path);
  }
}

reportSkippedLegacy();
if (unformatted.length > 0) {
  console.error("Prettier found unformatted files:");
  for (const path of unformatted) console.error(`  - ${path}`);
  console.error("Run npm run format and check the resulting diff.");
  process.exit(1);
}

console.log(`Prettier ${write ? "formatted" : "checked"} ${eligible.length} file(s).`);

function changedFiles() {
  const workingTree = unique([
    ...gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"])
  ]);
  if (workingTree.length > 0) return { base: "HEAD", files: workingTree };

  const explicitBase = process.env.FORMAT_BASE?.trim();
  if (explicitBase && revisionExists(explicitBase)) {
    return {
      base: explicitBase,
      files: gitLines(["diff", "--name-only", "--diff-filter=ACMR", `${explicitBase}...HEAD`])
    };
  }
  if (revisionExists("HEAD^")) {
    return {
      base: "HEAD^",
      files: gitLines(["diff-tree", "--no-commit-id", "--name-only", "--diff-filter=ACMR", "-r", "HEAD^", "HEAD"])
    };
  }
  return { base: EMPTY_TREE, files: gitLines(["ls-files"]) };
}

async function formattedSource(path, source) {
  const config = (await resolveConfig(path)) ?? {};
  return format(source, { ...config, filepath: path });
}

async function isFormatted(path, source) {
  try {
    return source === (await formattedSource(path, source));
  } catch {
    return false;
  }
}

function reportSkippedLegacy() {
  if (skippedLegacy.length === 0) return;
  console.log(`Skipped ${skippedLegacy.length} modified legacy file(s) that predate the Prettier baseline.`);
}

function gitLines(args) {
  const result = spawnSync("git", args, { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function gitText(args) {
  const result = spawnSync("git", args, { encoding: "utf8", shell: false });
  return result.error || result.status !== 0 ? undefined : result.stdout;
}

function revisionExists(revision) {
  return (
    spawnSync("git", ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], {
      stdio: "ignore",
      shell: false
    }).status === 0
  );
}

function extension(path) {
  const match = path.match(/(?:^|\/)[^/]+(\.[^./]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}

function unique(values) {
  return [...new Set(values)].sort();
}
