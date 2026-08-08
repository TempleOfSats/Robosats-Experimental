import { sha256 } from "js-sha256";
import { ROBO_ADJECTIVES, ROBO_NOUNS } from "@/domains/identity/generated/robonameData";

const assetPackUrl = new URL("./generated/robot-identities.rsid", import.meta.url);
const groupOffsets = [0, 11, 21, 31, 43] as const;
const groupLengths = [11, 10, 10, 12, 13] as const;
const backgroundOffset = 56;
const backgroundLength = 21;
const packMagic = "RSIDPK01";
const maxNicknameLength = 18;
const avatarViewBoxSize = 256;

let assetPackPromise: Promise<ArrayBuffer> | undefined;
const packedImagePromises = new Map<number, Promise<string>>();

export function generateBrowserRoboname(hashId: string): string {
  let hash = hashId;
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const nickname = nicknameForHash(hash);
    if (nickname.length <= maxNicknameLength) return nickname;
    hash = sha256(`${hash}42`);
  }
  return "";
}

export async function generateBrowserRobohash(hashId: string): Promise<string> {
  const digest = await sha512Hex(hashId);
  const selection = selectRobotIdentity(digest);
  const [background, ...parts] = await Promise.all(
    [selection.background, ...selection.parts].map(readPackedImage)
  );
  const images = parts
    .map(
      (part) =>
        `<image width="${avatarViewBoxSize}" height="${avatarViewBoxSize}" href="data:image/webp;base64,${part}" filter="url(#hue)"/>`
    )
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${avatarViewBoxSize} ${avatarViewBoxSize}">` +
    `<defs><filter id="hue" color-interpolation-filters="sRGB"><feColorMatrix type="hueRotate" values="${selection.hue}"/></filter></defs>` +
    `<image width="${avatarViewBoxSize}" height="${avatarViewBoxSize}" href="data:image/webp;base64,${background}"/>${images}</svg>`;
  return `data:image/svg+xml;base64,${stringToBase64(svg)}`;
}

export function selectRobotIdentity(digest: string): {
  background: number;
  hue: number;
  parts: number[];
} {
  const chunks = splitDigest(digest);
  return {
    parts: groupOffsets.map((offset, index) => offset + Number(chunks[index] % BigInt(groupLengths[index]))),
    background: backgroundOffset + Number(chunks[6] % BigInt(backgroundLength)),
    hue: Number(chunks[7] % 360n)
  };
}

function nicknameForHash(hash: string): string {
  const maxNumber = 999n;
  const nounCount = BigInt(ROBO_NOUNS.length);
  const poolSize = maxNumber * nounCount * BigInt(ROBO_ADJECTIVES.length);
  const nicknameId = (BigInt(`0x${hash}`) * poolSize) / (1n << 256n);
  const adjectiveId = nicknameId / (maxNumber * nounCount);
  const remainder = nicknameId - adjectiveId * maxNumber * nounCount;
  const nounId = remainder / maxNumber;
  const number = remainder - nounId * maxNumber;
  return `${ROBO_ADJECTIVES[Number(adjectiveId)]}${ROBO_NOUNS[Number(nounId)]}${number}`;
}

function splitDigest(digest: string): bigint[] {
  const blockSize = Math.floor(digest.length / 11);
  return Array.from({ length: 11 }, (_, index) => {
    const start = index * blockSize;
    return BigInt(`0x${digest.slice(start, start + blockSize)}`);
  });
}

async function sha512Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readPackedImage(index: number): Promise<string> {
  const cached = packedImagePromises.get(index);
  if (cached) return cached;

  const promise = loadPackedImage(index);
  packedImagePromises.set(index, promise);
  return promise;
}

async function loadPackedImage(index: number): Promise<string> {
  const pack = await loadAssetPack();
  const view = new DataView(pack);
  const count = view.getUint16(8, true);
  if (index < 0 || index >= count) throw new Error(`Identity layer ${index} is outside the asset pack`);
  const directoryOffset = 12 + index * 8;
  const offset = view.getUint32(directoryOffset, true);
  const length = view.getUint32(directoryOffset + 4, true);
  return bytesToBase64(new Uint8Array(pack, offset, length));
}

async function loadAssetPack(): Promise<ArrayBuffer> {
  assetPackPromise ??= fetch(assetPackUrl).then(async (response) => {
    if (!response.ok) throw new Error(`Identity assets returned ${response.status}`);
    const pack = await response.arrayBuffer();
    const magic = new TextDecoder().decode(pack.slice(0, 8));
    if (magic !== packMagic) throw new Error("Identity asset pack is invalid");
    return pack;
  });
  return assetPackPromise;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function stringToBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}
