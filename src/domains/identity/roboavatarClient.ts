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
  if (cached) return cached;

  const persisted = await readPersistedAvatar(cacheKey);
  if (persisted) {
    avatarCache.set(cacheKey, persisted);
    return persisted;
  }
  const legacyPersisted =
    (await readPersistedAvatar(`${hashId};large`)) ?? (await readPersistedAvatar(`${hashId};small`));
  if (legacyPersisted) {
    avatarCache.set(cacheKey, legacyPersisted);
    void persistAvatar(cacheKey, legacyPersisted);
    return legacyPersisted;
  }

  const pending = avatarPromiseCache.get(cacheKey);
  if (pending) return pending;

  const promise = generateBrowserRobohash(hashId)
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

export function prewarmRobotAvatar(hashId: string): void {
  if (!hashId) return;
  void generateRobohash(hashId).catch(() => undefined);
}

async function readPersistedAvatar(cacheKey: string): Promise<string | undefined> {
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
