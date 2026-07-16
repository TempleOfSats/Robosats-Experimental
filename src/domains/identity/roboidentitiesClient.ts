import { async_generate_robohash, generate_roboname } from "robo-identities-wasm/robo_identities_wasm.js";

const avatarCache = new Map<string, string>();
const avatarPromiseCache = new Map<string, Promise<string>>();
const nameCache = new Map<string, string>();
const AVATAR_STORAGE_PREFIX = "robosats_avatar_v1:";

export function generateRoboname(hashId: string): string {
  if (!hashId) return "Robot";
  const cached = nameCache.get(hashId);
  if (cached) return cached;
  const name = generate_roboname(hashId);
  nameCache.set(hashId, name);
  return name;
}

export async function generateRobohash(hashId: string, size: "small" | "large"): Promise<string> {
  if (!hashId) return "";
  const cacheKey = `${hashId};${size}`;
  const cached = avatarCache.get(cacheKey);
  if (cached) return cached;

  const persisted = readPersistedAvatar(cacheKey);
  if (persisted) {
    avatarCache.set(cacheKey, persisted);
    return persisted;
  }

  const pending = avatarPromiseCache.get(cacheKey);
  if (pending) return pending;

  const pixels = size === "small" ? 80 : 256;
  const promise = async_generate_robohash(hashId, pixels)
    .then((base64Image) => {
      const image = `data:image/png;base64,${base64Image}`;
      avatarCache.set(cacheKey, image);
      persistAvatar(cacheKey, image);
      return image;
    })
    .finally(() => {
      avatarPromiseCache.delete(cacheKey);
    });

  avatarPromiseCache.set(cacheKey, promise);
  return promise;
}

export function prewarmRobohashes(hashId: string): void {
  if (!hashId) return;
  void generateRobohash(hashId, "small");
  void generateRobohash(hashId, "large");
}

/** Importing this module starts the cached WASM runtime. Call after a token is
 * generated so the identity reveal is ready by the time the user continues. */
export function prewarmRobotIdentity(hashId: string): void {
  if (!hashId) return;
  // Prioritize the quick preview. The full-size image is requested only when
  // an XL avatar is actually displayed.
  void generateRobohash(hashId, "small");
}

function readPersistedAvatar(cacheKey: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(`${AVATAR_STORAGE_PREFIX}${cacheKey}`);
    return value?.startsWith("data:image/png;base64,") ? value : undefined;
  } catch {
    return undefined;
  }
}

function persistAvatar(cacheKey: string, image: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${AVATAR_STORAGE_PREFIX}${cacheKey}`, image);
  } catch {
    // Avatar caching is a progressive enhancement; quota failures are harmless.
  }
}
