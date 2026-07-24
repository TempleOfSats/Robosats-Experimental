const KEY = "robosats_exp_ui_preferences";
type UiTheme = "dark" | "light";
type QrTheme = "paper" | "screen";
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
  localStorage.setItem(KEY, JSON.stringify(value));
  applyUiPreferences(value);
  window.dispatchEvent(new CustomEvent("robosats-ui-preferences", { detail: value }));
}

export function applyUiPreferences(value = readUiPreferences()) {
  const fontScale = Math.min(1.15, Math.max(0.9, value.fontScale));
  document.documentElement.dataset.theme = value.theme;
  document.documentElement.lang = value.language;
  document.documentElement.style.setProperty("--font-scale", `${fontScale * 100}%`);
}
