import {
  generateBrowserRobohash,
  generateBrowserRoboname
} from "@/domains/identity/roboidentitiesBrowser";

const avatarCache = new Map<string, string>();
const avatarPromiseCache = new Map<string, Promise<string>>();
const nameCache = new Map<string, string>();
const AVATAR_STORAGE_PREFIX = "robosats_avatar_v3:";

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

  const persisted = readPersistedAvatar(cacheKey);
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

function readPersistedAvatar(cacheKey: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(`${AVATAR_STORAGE_PREFIX}${cacheKey}`);
    return /^data:image\/(?:png|svg\+xml);base64,/.test(value ?? "") ? value ?? undefined : undefined;
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
