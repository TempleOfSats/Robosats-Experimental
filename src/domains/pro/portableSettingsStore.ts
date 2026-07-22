import { create } from "zustand";
import { readUiPreferences, saveUiPreferences } from "@/domains/settings/uiPreferences";
import { useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import {
  createPortableSettingsManifest,
  removeOfferPreset,
  saveOfferPreset,
  updatePortablePreferences,
  type OfferPresetInput,
  type PortableSettingsManifest
} from "@/domains/pro/portableSettings";

type PortableSettingsState = {
  manifest?: PortableSettingsManifest;
  initialize: () => void;
  hydrateFromVault: () => void;
  captureUiPreferences: () => void;
  savePreset: (preset: OfferPresetInput) => void;
  removePreset: (id: string) => void;
};

export const usePortableSettingsStore = create<PortableSettingsState>((set, get) => ({
  initialize: () => {
    const envelope = useGarageVaultStore.getState().envelope;
    if (!envelope) return;
    set({ manifest: envelope.settings });
    applyPortablePreferences(envelope.settings);
  },
  hydrateFromVault: () => {
    const settings = useGarageVaultStore.getState().envelope?.settings;
    if (!settings || JSON.stringify(settings) === JSON.stringify(get().manifest)) return;
    set({ manifest: settings });
    applyPortablePreferences(settings);
  },
  captureUiPreferences: () => {
    const envelope = useGarageVaultStore.getState().envelope;
    if (!envelope) return;
    const ui = readUiPreferences();
    const next = updatePortablePreferences(envelope.settings, {
      theme: ui.theme
    });
    if (next === envelope.settings) return;
    useGarageVaultStore.getState().replacePortableSettings(next);
    set({ manifest: next });
  },
  savePreset: (preset) => {
    const envelope = useGarageVaultStore.getState().envelope;
    if (!envelope) throw new Error("Fleet is not ready.");
    const next = saveOfferPreset(envelope.settings, preset);
    useGarageVaultStore.getState().replacePortableSettings(next);
    set({ manifest: next });
  },
  removePreset: (id) => {
    const envelope = useGarageVaultStore.getState().envelope;
    if (!envelope) return;
    const next = removeOfferPreset(envelope.settings, id);
    if (next === envelope.settings) return;
    useGarageVaultStore.getState().replacePortableSettings(next);
    set({ manifest: next });
  }
}));

export function resetPortableSettingsStoreForTests(): void {
  usePortableSettingsStore.setState({ manifest: undefined });
}

function applyPortablePreferences(settings: PortableSettingsManifest): void {
  const ui = readUiPreferences();
  if (ui.theme === settings.theme.value) return;
  saveUiPreferences({
    ...ui,
    theme: settings.theme.value
  });
}

export function emptyPortableSettings(deviceId: string): PortableSettingsManifest {
  const ui = readUiPreferences();
  return createPortableSettingsManifest(deviceId, { theme: ui.theme });
}
