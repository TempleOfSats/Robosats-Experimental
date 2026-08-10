import { generateBrowserRobohash } from "@/domains/identity/roboavatarBrowser";

const avatarCache = new Map<string, string>();
const avatarPromiseCache = new Map<string, Promise<string>>();
const AVATAR_CACHE_NAME = "robosats-exp-avatar-cache-v3";
const AVATAR_CACHE_PATH = "https://robosats.invalid/avatar-cache/v3/";
const AVATAR_CACHE_LIMIT = 32;

export async function generateRobohash(hashId: string): Promise<string> {
  if (!hashId) return "";
  const cacheKey = hashId;
  const cached = avatarCache.get(cacheKey);
  if (cached) {
    rememberAvatar(cacheKey, cached);
    return cached;
  }

  const pending = avatarPromiseCache.get(cacheKey);
  if (pending) return pending;

  const promise = loadOrGenerateAvatar(hashId).finally(() => {
    avatarPromiseCache.delete(cacheKey);
  });

  avatarPromiseCache.set(cacheKey, promise);
  return promise;
}

export function prewarmRobotAvatar(hashId: string): void {
  if (!hashId) return;
  void generateRobohash(hashId).catch(() => undefined);
}

async function loadOrGenerateAvatar(hashId: string): Promise<string> {
  const persisted = await readPersistedAvatar(hashId);
  if (persisted) {
    rememberAvatar(hashId, persisted.image);
    if (persisted.legacy) void persistAvatar(hashId, persisted.image);
    return persisted.image;
  }

  const image = await generateBrowserRobohash(hashId);
  rememberAvatar(hashId, image);
  void persistAvatar(hashId, image);
  return image;
}

async function readPersistedAvatar(hashId: string): Promise<{ image: string; legacy: boolean } | undefined> {
  if (typeof caches === "undefined") return undefined;
  try {
    const cache = await caches.open(AVATAR_CACHE_NAME);
    for (const [cacheKey, legacy] of [
      [hashId, false],
      [`${hashId};large`, true],
      [`${hashId};small`, true]
    ] as const) {
      const response = await cache.match(avatarCacheRequest(cacheKey));
      const value = await response?.text();
      if (value && /^data:image\/(?:png|svg\+xml);base64,/.test(value)) {
        return { image: value, legacy };
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function rememberAvatar(cacheKey: string, image: string): void {
  avatarCache.delete(cacheKey);
  avatarCache.set(cacheKey, image);
  while (avatarCache.size > AVATAR_CACHE_LIMIT) {
    const oldestKey = avatarCache.keys().next().value;
    if (oldestKey === undefined) break;
    avatarCache.delete(oldestKey);
  }
}

async function persistAvatar(cacheKey: string, image: string): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(AVATAR_CACHE_NAME);
    const request = avatarCacheRequest(cacheKey);
    await cache.delete(request);
    await cache.put(
      request,
      new Response(image, {
        headers: { "Content-Type": "text/plain;charset=UTF-8" }
      })
    );
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - AVATAR_CACHE_LIMIT)).map((key) => cache.delete(key)));
  } catch {
    // Avatar caching is a progressive enhancement; quota failures are harmless.
  }
}

function avatarCacheRequest(cacheKey: string): Request {
  return new Request(`${AVATAR_CACHE_PATH}${encodeURIComponent(cacheKey)}`);
}
