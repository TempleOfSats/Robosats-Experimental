import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultProPreferences,
  parseProPreferences,
  PRO_PREFERENCES_KEY,
  useProPreferencesStore
} from "@/domains/pro/proPreferencesStore";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  useProPreferencesStore.setState(defaultProPreferences);
});

afterEach(() => vi.unstubAllGlobals());

describe("PRO preferences", () => {
  it("defaults to disabled when persisted data is absent or malformed", () => {
    expect(parseProPreferences(null)).toEqual(defaultProPreferences);
    expect(parseProPreferences("not-json")).toEqual(defaultProPreferences);
    expect(parseProPreferences('{"enabled":"yes","lastView":"invalid"}')).toEqual(defaultProPreferences);
  });

  it("persists workflow state without any robot secret", () => {
    useProPreferencesStore.getState().setEnabled(true);
    useProPreferencesStore.getState().setLastView("robots");
    useProPreferencesStore.getState().markSetupSeen();

    expect(JSON.parse(storage.get(PRO_PREFERENCES_KEY) ?? "{}")).toEqual({
      enabled: true,
      setupSeen: true,
      lastView: "robots"
    });
  });

  it("reloads a valid local preference", () => {
    storage.set(PRO_PREFERENCES_KEY, JSON.stringify({ enabled: true, setupSeen: false, lastView: "robots" }));
    useProPreferencesStore.getState().reload();
    expect(useProPreferencesStore.getState()).toMatchObject({ enabled: true, setupSeen: false, lastView: "robots" });
  });
});
