import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const checkFormatPath = fileURLToPath(new URL("./check-format.mjs", import.meta.url));
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("format check", () => {
  it("fails closed when Git cannot be started", () => {
    const result = runCheck(process.cwd(), { PATH: "" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unable to run git diff");
  });

  it("checks an untracked file that is absent from HEAD", () => {
    const repository = createRepository();
    writeFileSync(join(repository, "new-file.mjs"), 'export const value = "new";\n');

    const result = runCheck(repository);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Prettier checked 1 file(s).");
  });

  it("uses the empty tree when a clean repository has no parent revision", () => {
    const repository = createRepository({ "entry.mjs": 'export const value = "tracked";\n' });

    const result = runCheck(repository);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Prettier checked 1 file(s).");
  });
});

function createRepository(files = { "base.txt": "base\n" }) {
  const repository = mkdtempSync(join(tmpdir(), "robosats-format-check-"));
  temporaryDirectories.push(repository);
  runGit(repository, ["init", "--quiet"]);
  for (const [path, content] of Object.entries(files)) writeFileSync(join(repository, path), content);
  runGit(repository, ["add", "."]);
  runGit(repository, [
    "-c",
    "user.name=Format Check",
    "-c",
    "user.email=format-check@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "test fixture"
  ]);
  return repository;
}

function runCheck(cwd, environment = {}) {
  return spawnSync(process.execPath, [checkFormatPath], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment }
  });
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
}
