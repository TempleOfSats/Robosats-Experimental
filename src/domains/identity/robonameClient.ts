import { generateBrowserRoboname } from "@/domains/identity/robonameBrowser";

const nameCache = new Map<string, string>();

export function generateRoboname(hashId: string): string {
  if (!hashId) return "Robot";
  const cached = nameCache.get(hashId);
  if (cached) return cached;
  const name = generateBrowserRoboname(hashId);
  nameCache.set(hashId, name);
  return name;
}
