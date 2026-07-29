import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const files = globSync(["src/**/*.css"], {
  exclude: ["src/styles/globals.css"]
});
const directColorPattern = /#[\da-f]{3,8}\b|rgba?\(/gi;
const findings = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(directColorPattern)) {
    const line = source.slice(0, match.index).split("\n").length;
    findings.push(`${file}:${line}: ${match[0]}`);
  }
}

if (findings.length > 0) {
  console.error("Direct colors must be defined as semantic tokens in src/styles/globals.css:");
  console.error(findings.join("\n"));
  process.exit(1);
}

console.log(`Theme color check passed for ${files.length} stylesheets.`);
