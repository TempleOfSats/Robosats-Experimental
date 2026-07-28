import {
  generateBrowserRobohash,
  generateBrowserRoboname
} from "@/domains/identity/roboidentitiesBrowser";

const avatarCache = new Map<string, string>();
const avatarPromiseCache = new Map<string, Promise<string>>();
const nameCache = new Map<string, string>();
const AVATAR_STORAGE_PREFIX = "robosats_avatar_v3:";
const AVATAR_CACHE_NAME = "robosats-exp-avatar-cache-v3";
const AVATAR_CACHE_PATH = "https://robosats.invalid/avatar-cache/v3/";
const AVATAR_CACHE_LIMIT = 32;
let legacyCacheCleared = false;

export function generateRoboname(hashId: string): string {
  if (!hashId) return "Robot";
  const cached = nameCache.get(hashId);
  if (cached) return cached;
  const name = generateBrowserRoboname(hashId);
  nameCache.set(hashId, name);
  return name;
}

export async function generateRobohash(hashId: string, size: "small" | "large"): Promise<string> {
  if (!hashId) return "";
  const cacheKey = `${hashId};${size}`;
  const cached = avatarCache.get(cacheKey);
  if (cached) return cached;

  const persisted = await readPersistedAvatar(cacheKey);
  if (persisted) {
    avatarCache.set(cacheKey, persisted);
    return persisted;
  }

  const pending = avatarPromiseCache.get(cacheKey);
  if (pending) return pending;

  const pixels = size === "small" ? 80 : 256;
  const promise = generateBrowserRobohash(hashId, pixels)
    .then((image) => {
      avatarCache.set(cacheKey, image);
      void persistAvatar(cacheKey, image);
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
  void generateRobohash(hashId, "small").catch(() => undefined);
  void generateRobohash(hashId, "large").catch(() => undefined);
}

export function prewarmRobotIdentity(hashId: string): void {
  if (!hashId) return;
  void generateRobohash(hashId, "small").catch(() => undefined);
}

export async function prepareRobotIdentity(hashId: string): Promise<{ avatar: string; nickname: string }> {
  const avatar = await generateRobohash(hashId, "small");
  return {
    avatar,
    nickname: generateRoboname(hashId)
  };
}

async function readPersistedAvatar(cacheKey: string): Promise<string | undefined> {
  clearLegacyAvatarCache();
  if (typeof caches === "undefined") return undefined;
  try {
    const cache = await caches.open(AVATAR_CACHE_NAME);
    const response = await cache.match(avatarCacheRequest(cacheKey));
    const value = await response?.text();
    return /^data:image\/(?:png|svg\+xml);base64,/.test(value ?? "") ? value : undefined;
  } catch {
    return undefined;
  }
}

async function persistAvatar(cacheKey: string, image: string): Promise<void> {
  clearLegacyAvatarCache();
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(AVATAR_CACHE_NAME);
    const request = avatarCacheRequest(cacheKey);
    await cache.delete(request);
    await cache.put(request, new Response(image, {
      headers: { "Content-Type": "text/plain;charset=UTF-8" }
    }));
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - AVATAR_CACHE_LIMIT)).map((key) => cache.delete(key)));
  } catch {
    // Avatar caching is a progressive enhancement; quota failures are harmless.
  }
}

function avatarCacheRequest(cacheKey: string): Request {
  return new Request(`${AVATAR_CACHE_PATH}${encodeURIComponent(cacheKey)}`);
}

function clearLegacyAvatarCache(): void {
  if (legacyCacheCleared || typeof window === "undefined") return;
  legacyCacheCleared = true;
  try {
    const legacyKeys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(AVATAR_STORAGE_PREFIX)));
    for (const key of legacyKeys) window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private contexts; the in-memory cache still works.
  }
}
