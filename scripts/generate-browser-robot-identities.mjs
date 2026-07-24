import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeSource = resolve(root, "android/robo-identities-native/robohash/src");
const upstreamSource = process.env.ROBO_IDENTITIES_SOURCE
  ? resolve(process.env.ROBO_IDENTITIES_SOURCE)
  : undefined;
const generatedDirectory = resolve(root, "src/domains/identity/generated");

const partNames = ["BODY", "FACE", "MOUTH", "EYES", "ACCESSORY"];
const robotPartsSource = await readFile(resolve(nativeSource, "robot_parts.rs"), "utf8");
const backgroundsSource = await readFile(resolve(nativeSource, "backgrounds.rs"), "utf8");
const groups = partNames.map((name) => extractRustArray(robotPartsSource, name));
const backgrounds = extractRustArray(backgroundsSource, "BACKGROUNDS");
const images = [...groups.flat(), ...backgrounds].map((value) => Buffer.from(value, "base64"));

await mkdir(generatedDirectory, { recursive: true });
await writeFile(resolve(generatedDirectory, "robot-identities.rsid"), buildAssetPack(images));

let dictionarySummary = "existing nickname dictionaries";
if (upstreamSource) {
  const adjectives = extractRustArray(
    await readFile(resolve(upstreamSource, "robonames/src/dicts/en/adjectives.rs"), "utf8"),
    "ADJECTIVES"
  );
  const nouns = extractRustArray(
    await readFile(resolve(upstreamSource, "robonames/src/dicts/en/nouns.rs"), "utf8"),
    "NOUNS"
  );
  const dictionaryModule = [
    "// Generated from robo-identities. Do not edit by hand.",
    "// Source license: MIT, Copyright (c) 2023 Reckless_Satoshi.",
    `export const ROBO_ADJECTIVES = ${JSON.stringify(adjectives)} as const;`,
    `export const ROBO_NOUNS = ${JSON.stringify(nouns)} as const;`,
    ""
  ].join("\n");
  await writeFile(resolve(generatedDirectory, "robonameData.ts"), dictionaryModule);
  dictionarySummary = `${adjectives.length} adjectives and ${nouns.length} nouns`;
} else {
  await access(resolve(generatedDirectory, "robonameData.ts"));
}

console.log(
  `Generated ${images.length} identity layers (${images.reduce((sum, image) => sum + image.length, 0)} bytes), ` +
    `${dictionarySummary}. Set ROBO_IDENTITIES_SOURCE to refresh the dictionaries.`
);

function extractRustArray(source, name) {
  const declaration = new RegExp(`(?:pub\\s+static|const)\\s+${name}\\s*:[^=]+=[\\s\\n]*\\[([\\s\\S]*?)\\];`);
  const body = source.match(declaration)?.[1];
  if (!body) throw new Error(`Could not find Rust array ${name}`);

  return [...body.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
}

function buildAssetPack(images) {
  const magic = Buffer.from("RSIDPK01", "ascii");
  const directoryOffset = 12;
  const dataOffset = directoryOffset + images.length * 8;
  const header = Buffer.alloc(dataOffset);
  magic.copy(header);
  header.writeUInt16LE(images.length, 8);
  header.writeUInt16LE(1, 10);

  let offset = dataOffset;
  images.forEach((image, index) => {
    header.writeUInt32LE(offset, directoryOffset + index * 8);
    header.writeUInt32LE(image.length, directoryOffset + index * 8 + 4);
    offset += image.length;
  });

  return Buffer.concat([header, ...images]);
}
