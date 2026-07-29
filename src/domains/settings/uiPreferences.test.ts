import { describe, expect, it, vi } from "vitest";
import {
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  describeFontScale,
  readUiPreferences,
  saveUiPreferences
} from "@/domains/settings/uiPreferences";

describe("UI preferences", () => {
  it("keeps the supported text range aligned with its labels", () => {
    expect(MIN_FONT_SCALE).toBe(0.9);
    expect(MAX_FONT_SCALE).toBe(1.15);
    expect(describeFontScale(MIN_FONT_SCALE)).toBe("extra small");
    expect(describeFontScale(MAX_FONT_SCALE)).toBe("largest");
  });

  it("falls back to dark for removed or unknown theme values", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    });
    localStorage.setItem("robosats_exp_ui_preferences", JSON.stringify({ theme: "system" }));
    expect(readUiPreferences().theme).toBe("dark");
    vi.unstubAllGlobals();
  });

  it("persists the selected theme before notifying mounted controls", () => {
    const values = new Map<string, string>();
    let observedTheme = "";
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    });
    vi.stubGlobal("document", {
      documentElement: {
        dataset: {},
        lang: "",
        style: { setProperty: vi.fn() }
      }
    });
    vi.stubGlobal("CustomEvent", class<T> extends Event {
      detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail as T;
      }
    });
    vi.stubGlobal("window", {
      dispatchEvent: () => {
        observedTheme = readUiPreferences().theme;
        return true;
      }
    });

    saveUiPreferences({ theme: "light", fontScale: 1, qrTheme: "paper", language: "en" });

    expect(observedTheme).toBe("light");
    vi.unstubAllGlobals();
  });
});
