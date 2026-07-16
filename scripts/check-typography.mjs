import { readFile } from "node:fs/promises";

const stylePaths = [
  "src/styles/globals.css",
  "src/styles/components.css",
  "src/styles/layout.css",
  "src/styles/typography.css"
];

const [mainSource, fontLicense, ...styles] = await Promise.all([
  readFile("src/main.tsx", "utf8"),
  readFile("public/static/licenses/PublicSans-OFL.txt", "utf8"),
  ...stylePaths.map((path) => readFile(path, "utf8"))
]);
const css = styles.join("\n");
const failures = [];

if (!mainSource.includes('@fontsource-variable/public-sans/wght.css')) {
  failures.push("Public Sans must be bundled from @fontsource-variable/public-sans.");
}

if (
  !fontLicense.includes("Copyright 2015 The Public Sans Project Authors") ||
  !fontLicense.includes("SIL OPEN FONT LICENSE Version 1.1")
) {
  failures.push("The distributed Public Sans OFL notice is missing or incomplete.");
}

for (const match of css.matchAll(/font-size\s*:\s*([^;]+);/g)) {
  if (/\b(?:vw|vh|vmin|vmax)\b/.test(match[1])) {
    failures.push(`Viewport-only font sizing is not allowed: ${match[0]}`);
  }

  const remValue = match[1].trim().match(/^(\d*\.?\d+)rem$/)?.[1];
  if (remValue && Number(remValue) < 0.75) {
    failures.push(`Visible text must not be smaller than 0.75rem: ${match[0]}`);
  }
}

for (const match of css.matchAll(/font-weight\s*:\s*(\d+)\s*;/g)) {
  if (![400, 500, 600, 700].includes(Number(match[1]))) {
    failures.push(`Unsupported font weight ${match[1]}; use 400, 500, 600, or 700.`);
  }
}

if (/text-transform\s*:\s*uppercase/.test(css)) {
  failures.push("Forced uppercase typography is not part of the UI type system.");
}

for (const match of css.matchAll(/letter-spacing\s*:\s*([^;]+);/g)) {
  if (!/^0(?:\.0+)?$/.test(match[1].trim())) {
    failures.push(`Custom letter spacing is not allowed: ${match[0]}`);
  }
}

const amountRule = styles[1].match(/\.amount-mono\s*\{([^}]+)\}/)?.[1] ?? "";
if (/font-mono/.test(amountRule)) {
  failures.push("Financial amounts must use tabular Public Sans, not monospace.");
}

for (const token of [
  "--type-body-size: 1rem",
  "--type-body-line: 1.5rem",
  "--type-compact-size: 0.875rem",
  "--type-caption-size: 0.75rem",
  "--type-machine-size: 0.8125rem"
]) {
  if (!styles[0].includes(token)) failures.push(`Missing required type token: ${token}`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Typography policy checks passed.");
