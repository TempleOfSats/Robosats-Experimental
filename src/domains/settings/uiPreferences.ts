const KEY = "robosats_exp_ui_preferences";
export type UiTheme = "dark" | "light";
type QrTheme = "paper" | "screen";
export const MIN_FONT_SCALE = 0.9;
export const MAX_FONT_SCALE = 1.15;
export const FONT_SCALE_STEP = 0.05;

export interface UiPreferences {
  theme: UiTheme;
  fontScale: number;
  qrTheme: QrTheme;
  language: string;
}

export function readUiPreferences(): UiPreferences {
  const defaults: UiPreferences = { theme: "dark", fontScale: 1, qrTheme: "paper", language: "en" };
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<UiPreferences>;
    return {
      theme: parsed.theme === "light" ? "light" : "dark",
      fontScale: typeof parsed.fontScale === "number" && Number.isFinite(parsed.fontScale) ? parsed.fontScale : defaults.fontScale,
      qrTheme: parsed.qrTheme === "screen" ? "screen" : "paper",
      language: typeof parsed.language === "string" && /^[A-Za-z0-9-]{2,16}$/.test(parsed.language)
        ? parsed.language
        : defaults.language
    };
  } catch { return defaults; }
}

export function saveUiPreferences(value: UiPreferences) {
  applyUiPreferences(value);
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // The active session should still reflect the user's choice when persistence is unavailable.
  }
  window.dispatchEvent(new CustomEvent("robosats-ui-preferences", { detail: value }));
}

export function applyUiPreferences(value = readUiPreferences()) {
  const fontScale = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value.fontScale));
  document.documentElement.dataset.theme = value.theme;
  document.documentElement.lang = value.language;
  document.documentElement.style.setProperty("--font-scale", `${fontScale * 100}%`);
}

export function describeFontScale(fontScale: number): string {
  if (fontScale <= 0.9) return "extra small";
  if (fontScale <= 0.95) return "small";
  if (fontScale <= 1) return "medium";
  if (fontScale <= 1.05) return "large";
  if (fontScale <= 1.1) return "extra large";
  return "largest";
}
