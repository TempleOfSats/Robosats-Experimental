import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const indexPath = fileURLToPath(
  new URL("../public/static/assets/geo/f2f-cities.json", import.meta.url)
);
const curatedPath = fileURLToPath(new URL("./f2f-bitcoin-cities.json", import.meta.url));
const [indexSource, curatedSource] = await Promise.all([
  readFile(indexPath, "utf8"),
  readFile(curatedPath, "utf8")
]);
const index = JSON.parse(indexSource);
const curatedEntries = JSON.parse(curatedSource);
const curatedCities = curatedEntries.map(({ city }) => city);
const curatedKeys = new Set(curatedCities.map(cityKey));
const merged = [
  ...index.filter((city) => city.a !== "AQ" && !curatedKeys.has(cityKey(city))),
  ...curatedCities
].sort((left, right) => (
  right.p - left.p
  || left.n.localeCompare(right.n)
  || left.a.localeCompare(right.a)
));

await writeFile(indexPath, `${JSON.stringify(merged)}\n`);
console.log(`Merged ${curatedCities.length} Bitcoin-relevant places into ${merged.length} F2F city records.`);

function cityKey(city) {
  return `${city.a}:${city.n}`.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
