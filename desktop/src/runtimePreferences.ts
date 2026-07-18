import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type RuntimePreferences = {
  notificationsEnabled: boolean;
};

const defaults: RuntimePreferences = {
  notificationsEnabled: false
};

export function readRuntimePreferences(filePath: string): RuntimePreferences {
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8")) as Partial<RuntimePreferences>;
    return {
      notificationsEnabled: value.notificationsEnabled === true
    };
  } catch {
    return { ...defaults };
  }
}

export function writeRuntimePreferences(filePath: string, preferences: RuntimePreferences): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(preferences, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

export type DesktopNotificationPayload = {
  title: string;
  body: string;
  route?: string;
};

export function normalizeNotificationPayload(value: unknown): DesktopNotificationPayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<DesktopNotificationPayload>;
  if (typeof candidate.title !== "string" || typeof candidate.body !== "string") return undefined;
  const title = candidate.title.trim().slice(0, 80);
  const body = candidate.body.trim().slice(0, 240);
  if (!title || !body) return undefined;
  const route = typeof candidate.route === "string" && isInternalOrderRoute(candidate.route)
    ? candidate.route
    : undefined;
  return { title, body, route };
}

export function isInternalOrderRoute(value: string): boolean {
  return /^\/order\/[a-z0-9-]+\/[1-9]\d*$/i.test(value);
}
