import { readFile, readdir, stat } from "node:fs/promises";
import { extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../public/static/assets/payment-methods/", import.meta.url));
const f2fMap = fileURLToPath(new URL("../public/static/assets/geo/f2f-world.geo.json", import.meta.url));
const f2fCities = fileURLToPath(new URL("../public/static/assets/geo/f2f-cities.json", import.meta.url));
const f2fBitcoinCities = fileURLToPath(new URL("./f2f-bitcoin-cities.json", import.meta.url));
const files = await walk(root);
const imageFiles = files.filter((file) => [".png", ".jpg", ".jpeg", ".webp"].includes(extname(file).toLowerCase()));
const sizes = await Promise.all(imageFiles.map(async (file) => ({ file, bytes: (await stat(file)).size })));
const total = sizes.reduce((sum, item) => sum + item.bytes, 0);
const oversized = sizes.filter((item) => item.bytes > 16 * 1_024);

if (oversized.length > 0) {
  throw new Error(`Payment icons exceed 16 KiB:\n${oversized.map((item) => `${relative(root, item.file)}: ${item.bytes}`).join("\n")}`);
}

if (total > 512 * 1_024) {
  throw new Error(`Payment icons total ${total} bytes; budget is 524288 bytes.`);
}

const f2fMapSource = await readFile(f2fMap);
const f2fMapBytes = f2fMapSource.byteLength;
const f2fMapGzipBytes = gzipSync(f2fMapSource, { level: 9 }).byteLength;
const f2fMapGeoJson = JSON.parse(f2fMapSource.toString("utf8"));
if (f2fMapBytes > 320 * 1_024) {
  throw new Error(`F2F map uses ${f2fMapBytes} raw bytes; budget is 327680 bytes.`);
}
if (f2fMapGzipBytes > 96 * 1_024) {
  throw new Error(`F2F map uses ${f2fMapGzipBytes} gzip bytes; budget is 98304 bytes.`);
}
if (!Array.isArray(f2fMapGeoJson.features) || f2fMapGeoJson.features.length < 230) {
  throw new Error("F2F map must retain at least 230 country and territory features.");
}
for (const countryCode of ["ITA", "JPN", "GRC", "IDN", "PHL", "NZL"]) {
  const country = f2fMapGeoJson.features.find((feature) => feature.properties?.A3 === countryCode);
  if (!country || country.geometry?.type !== "MultiPolygon") {
    throw new Error(`F2F map must retain detailed multipolygon geometry for ${countryCode}.`);
  }
}

const f2fCitiesSource = await readFile(f2fCities);
const f2fBitcoinCitiesSource = await readFile(f2fBitcoinCities);
const f2fCitiesBytes = f2fCitiesSource.byteLength;
const f2fCitiesGzipBytes = gzipSync(f2fCitiesSource, { level: 9 }).byteLength;
const f2fCityIndex = JSON.parse(f2fCitiesSource.toString("utf8"));
const curatedF2fCities = JSON.parse(f2fBitcoinCitiesSource.toString("utf8")).map(({ city }) => city);
if (f2fCitiesBytes > 160 * 1_024 || f2fCitiesGzipBytes > 48 * 1_024) {
  throw new Error(`F2F cities use ${f2fCitiesBytes} raw and ${f2fCitiesGzipBytes} gzip bytes; budgets are 163840 and 49152 bytes.`);
}
if (!Array.isArray(f2fCityIndex) || f2fCityIndex.length < 1_200) {
  throw new Error("F2F city index must retain at least 1,200 worldwide places.");
}
if (f2fCityIndex.some((city) => city.a === "AQ" || city.c === "Antarctica")) {
  throw new Error("F2F city index must exclude Antarctic research stations and islands.");
}
for (const requiredCity of [
  { n: "Rome", a: "IT" },
  { n: "Tokyo", a: "JP" },
  ...curatedF2fCities
]) {
  if (!f2fCityIndex.some((city) => city.n === requiredCity.n && city.a === requiredCity.a)) {
    throw new Error(`F2F city index must retain ${requiredCity.n}, ${requiredCity.a}.`);
  }
}

console.log(`${imageFiles.length} payment icons use ${total} bytes within the Tor asset budget.`);
console.log(`The offline F2F map uses ${f2fMapBytes} raw bytes and ${f2fMapGzipBytes} gzip bytes within the Tor asset budget.`);
console.log(`The offline F2F city index uses ${f2fCitiesBytes} raw bytes and ${f2fCitiesGzipBytes} gzip bytes within the Tor asset budget.`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  }))).flat();
}
