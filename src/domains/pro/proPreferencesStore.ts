import { create } from "zustand";
import { systemClient } from "@/domains/transport/systemClient";

export const PRO_PREFERENCES_KEY = "robosats_exp_pro_preferences_v1";

export type ProView = "trades" | "robots";

export type ProPreferences = {
  enabled: boolean;
  setupSeen: boolean;
  lastView: ProView;
};

type ProPreferencesState = ProPreferences & {
  setEnabled: (enabled: boolean) => void;
  markSetupSeen: () => void;
  setLastView: (lastView: ProView) => void;
  reload: () => void;
};

export const defaultProPreferences: ProPreferences = {
  enabled: false,
  setupSeen: false,
  lastView: "trades"
};

export const useProPreferencesStore = create<ProPreferencesState>((set, get) => ({
  ...readProPreferences(),
  setEnabled: (enabled) => update(set, get, { enabled }),
  markSetupSeen: () => update(set, get, { setupSeen: true }),
  setLastView: (lastView) => update(set, get, { lastView }),
  reload: () => set(readProPreferences())
}));

export function parseProPreferences(raw: string | null): ProPreferences {
  if (!raw) return { ...defaultProPreferences };
  try {
    const parsed = JSON.parse(raw) as Partial<ProPreferences>;
    return {
      enabled: parsed.enabled === true,
      setupSeen: parsed.setupSeen === true,
      lastView: parsed.lastView === "robots" ? "robots" : "trades"
    };
  } catch {
    return { ...defaultProPreferences };
  }
}

function readProPreferences(): ProPreferences {
  try {
    return parseProPreferences(systemClient.getItem(PRO_PREFERENCES_KEY));
  } catch {
    return { ...defaultProPreferences };
  }
}

function update(
  set: (preferences: Partial<ProPreferencesState>) => void,
  get: () => ProPreferencesState,
  patch: Partial<ProPreferences>
): void {
  const next: ProPreferences = {
    enabled: patch.enabled ?? get().enabled,
    setupSeen: patch.setupSeen ?? get().setupSeen,
    lastView: patch.lastView ?? get().lastView
  };
  try {
    systemClient.setItem(PRO_PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // A blocked storage backend must not prevent the runtime preference change.
  }
  set(next);
}
