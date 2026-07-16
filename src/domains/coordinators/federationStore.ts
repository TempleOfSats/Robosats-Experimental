import { create } from "zustand";
import { toUserMessage } from "@/lib/userError";
import { getCoordinatorAvatarUrl, getCoordinatorBadgeIcons } from "@/domains/coordinators/coordinatorAssets";
import { fetchCoordinatorInfo, fetchCoordinatorLimits } from "@/domains/coordinators/coordinatorApi";
import { buildCoordinatorUrl, detectCoordinatorOrigin } from "@/domains/coordinators/coordinatorUrl";
import { defaultFederation } from "@/domains/coordinators/defaultFederation";
import type {
  CoordinatorConnection,
  CoordinatorDefinition,
  CoordinatorSummary,
  Network,
  Origin
} from "@/domains/coordinators/coordinator.types";
import { systemClient } from "@/domains/transport/systemClient";

type FederationState = {
  coordinators: CoordinatorSummary[];
  connection: CoordinatorConnection;
  lastRefreshed?: number;
  network: Network;
  origin: Origin;
  refreshing: boolean;
  selfhostedClient: boolean;
  refreshCoordinator: (shortAlias: string, options?: FederationRefreshOptions) => Promise<boolean>;
  refreshCoordinators: (options?: FederationRefreshOptions) => Promise<void>;
  setConnection: (connection: CoordinatorConnection) => void;
  setNetwork: (network: Network) => void;
  setOrigin: (origin: Origin) => void;
  setSelfhostedClient: (selfhostedClient: boolean) => void;
  toggleCoordinator: (shortAlias: string) => void;
  addCustomCoordinator: (shortAlias: string, url: string) => void;
  removeCustomCoordinator: (shortAlias: string) => void;
};

type FederationSettings = Pick<FederationState, "connection" | "network" | "origin" | "selfhostedClient">;
type FederationRefreshOptions = {
  force?: boolean;
};
type CachedFederation = {
  savedAt: number;
  settings: FederationSettings;
  coordinators: CoordinatorSummary[];
};
type FederationSet = (partial: Partial<FederationState> | ((state: FederationState) => Partial<FederationState>)) => void;
type FederationGet = () => FederationState;

const FEDERATION_SETTINGS_KEY = "federation_settings";
const FEDERATION_CACHE_KEY = "robosats_exp_federation_cache_v1";
const FEDERATION_PREFERENCES_KEY = "robosats_exp_federation_preferences_v1";
const defaultCoordinatorAliases = new Set(defaultFederation.map((coordinator) => coordinator.shortAlias));
export const FEDERATION_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
export const FEDERATION_REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000;
const defaultSettings: FederationSettings = {
  connection: "nostr",
  network: "mainnet",
  origin: detectCoordinatorOrigin(),
  selfhostedClient: false
};
const initialSettings = readFederationSettings();
const initialCachedFederation = readFederationCache(initialSettings);
const initialCoordinators = applyCoordinatorPreferences(initialCachedFederation?.coordinators ?? buildCoordinatorSummaries(initialSettings));
persistNativeFederation(initialCoordinators);

let refreshInFlight: Promise<void> | undefined;
let refreshInFlightKey = "";
const coordinatorRefreshes = new Map<string, Promise<boolean>>();
const coordinatorRetryAfter = new Map<string, number>();
const coordinatorRetryFailures = new Map<string, number>();
const COORDINATOR_RETRY_BASE_MS = 15_000;
const COORDINATOR_RETRY_MAX_MS = 2 * 60_000;

export const useFederationStore = create<FederationState>((set, get) => ({
  coordinators: initialCoordinators,
  connection: initialSettings.connection,
  lastRefreshed: initialCachedFederation?.savedAt,
  network: initialSettings.network,
  origin: initialSettings.origin,
  refreshing: false,
  selfhostedClient: initialSettings.selfhostedClient,
  refreshCoordinator: async (shortAlias, options = {}) => {
    const settings = currentFederationSettings(get());
    const requestKey = `${federationSettingsKey(settings)}|${shortAlias}`;
    const existing = coordinatorRefreshes.get(requestKey);
    if (existing) return existing;

    const coordinator = get().coordinators.find((item) => item.shortAlias === shortAlias);
    if (!coordinator) return false;
    if (!options.force && Date.now() < (coordinatorRetryAfter.get(requestKey) ?? 0)) return false;

    const refresh = (async () => {
      set((state) => ({
        coordinators: state.coordinators.map((item) => item.shortAlias === shortAlias
          ? { ...item, loading: true, error: undefined }
          : item)
      }));

      const refreshed = await refreshCoordinatorSummary(summaryToDefinition(coordinator), settings, coordinator);
      if (!sameFederationSettings(currentFederationSettings(get()), settings)) return false;

      const current = get();
      const coordinators = current.coordinators.map((item) => item.shortAlias === shortAlias
        ? { ...refreshed, enabled: item.enabled }
        : item);
      set({ coordinators });
      writeFederationCache(settings, coordinators, current.lastRefreshed ?? Date.now());

      if (refreshed.online) {
        coordinatorRetryAfter.delete(requestKey);
        coordinatorRetryFailures.delete(requestKey);
      } else {
        const failures = (coordinatorRetryFailures.get(requestKey) ?? 0) + 1;
        coordinatorRetryFailures.set(requestKey, failures);
        coordinatorRetryAfter.set(requestKey, Date.now() + Math.min(
          COORDINATOR_RETRY_MAX_MS,
          COORDINATOR_RETRY_BASE_MS * (2 ** (failures - 1))
        ));
      }
      return true;
    })().finally(() => coordinatorRefreshes.delete(requestKey));

    coordinatorRefreshes.set(requestKey, refresh);
    return refresh;
  },
  refreshCoordinators: async (options = {}) => {
    const settings = currentFederationSettings(get());
    const key = federationSettingsKey(settings);
    const state = get();

    // `force` bypasses freshness, not request coalescing. Route recovery and a
    // manual refresh can otherwise start the same expensive onion requests.
    if (refreshInFlight && refreshInFlightKey === key) return refreshInFlight;

    if (!options.force) {
      if (state.lastRefreshed && Date.now() - state.lastRefreshed < FEDERATION_REFRESH_MIN_INTERVAL_MS) return;
    }

    const refresh = refreshFederation(settings, set, get).finally(() => {
      if (refreshInFlight === refresh) {
        refreshInFlight = undefined;
        refreshInFlightKey = "";
      }
    });

    refreshInFlight = refresh;
    refreshInFlightKey = key;
    return refresh;
  },
  setConnection: (connection) =>
    set((state) =>
      applyFederationSettings({
        connection,
        network: state.network,
        origin: state.origin,
        selfhostedClient: state.selfhostedClient
      })
    ),
  setNetwork: (network) =>
    set((state) =>
      applyFederationSettings({
        connection: state.connection,
        network,
        origin: state.origin,
        selfhostedClient: state.selfhostedClient
      })
    ),
  setOrigin: (origin) =>
    set((state) =>
      applyFederationSettings({
        connection: state.connection,
        network: state.network,
        origin,
        selfhostedClient: state.selfhostedClient
      })
    ),
  setSelfhostedClient: (selfhostedClient) =>
    set((state) =>
      applyFederationSettings({
        connection: state.connection,
        network: state.network,
        origin: state.origin,
        selfhostedClient
      })
    ),
  toggleCoordinator: (shortAlias) => set((state) => {
    const coordinators = state.coordinators.map((coordinator) => coordinator.shortAlias === shortAlias
      ? { ...coordinator, enabled: !coordinator.enabled }
      : coordinator);
    persistCoordinatorPreferences(coordinators);
    return { coordinators };
  }),
  addCustomCoordinator: (shortAlias, url) => set((state) => {
    const alias = shortAlias.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const cleanUrl = url.trim().replace(/\/$/, "");
    if (!alias || !/^https?:\/\//.test(cleanUrl)) return state;
    const custom = buildCoordinatorSummary({
      shortAlias: alias,
      longAlias: shortAlias.trim(),
      color: "#8f8f8f",
      federated: false,
      mainnet: { onion: cleanUrl, clearnet: cleanUrl },
      testnet: { onion: cleanUrl, clearnet: cleanUrl }
    }, { ...currentFederationSettings(state), envBaseUrl: cleanUrl, hostUrl: window.location.origin });
    const coordinators = [...state.coordinators.filter((item) => item.shortAlias !== alias), { ...custom, url: cleanUrl, enabled: true }];
    persistCoordinatorPreferences(coordinators);
    return { coordinators };
  }),
  removeCustomCoordinator: (shortAlias) => set((state) => {
    if (defaultFederation.some((item) => item.shortAlias === shortAlias)) return state;
    const coordinators = state.coordinators.filter((item) => item.shortAlias !== shortAlias);
    persistCoordinatorPreferences(coordinators);
    return { coordinators };
  })
}));

function applyFederationSettings(settings: FederationSettings): Partial<FederationState> {
  persistFederationSettings(settings);
  const cached = readFederationCache(settings);
  return {
    ...settings,
    coordinators: applyCoordinatorPreferences(cached?.coordinators ?? buildCoordinatorSummaries(settings)),
    lastRefreshed: cached?.savedAt,
    refreshing: false
  };
}

async function refreshFederation(
  settings: FederationSettings,
  set: FederationSet,
  get: FederationGet
): Promise<void> {
  set((state) => ({
    refreshing: true,
    coordinators: state.coordinators.map((coordinator) => ({ ...coordinator, loading: true, error: undefined }))
  }));

  try {
    const current = get().coordinators;
    const refreshed = applyCoordinatorPreferences(await Promise.all(
      current.map((coordinator) => refreshCoordinatorSummary(summaryToDefinition(coordinator), settings, coordinator))
    ));
    const savedAt = Date.now();
    writeFederationCache(settings, refreshed, savedAt);
    if (!sameFederationSettings(currentFederationSettings(get()), settings)) return;
    set({ coordinators: refreshed, lastRefreshed: savedAt, refreshing: false });
  } catch {
    set((state) => ({
      refreshing: false,
      coordinators: state.coordinators.map((coordinator) => ({ ...coordinator, loading: false }))
    }));
  }
}

async function refreshCoordinatorSummary(
  definition: CoordinatorDefinition,
  settings: FederationSettings,
  previous?: CoordinatorSummary
): Promise<CoordinatorSummary> {
  const summary = buildCoordinatorSummary(definition, {
    ...settings,
    envBaseUrl: import.meta.env.VITE_ROBOSATS_API_BASE_URL,
    hostUrl: typeof window === "undefined" ? undefined : window.location.origin
  });

  if (!summary.url && definition.shortAlias !== "local") {
    return {
      ...summary,
      loading: false,
      online: false,
      error: `No ${settings.origin} URL configured for ${settings.network}`
    };
  }

  try {
    const [infoResult, limitsResult] = await Promise.allSettled([
      fetchCoordinatorInfo(summary.url),
      fetchCoordinatorLimits(summary.url)
    ]);
    const info = infoResult.status === "fulfilled" ? infoResult.value : undefined;
    const limits = limitsResult.status === "fulfilled" ? limitsResult.value : undefined;

    if (!info && !limits) {
      const reason = infoResult.status === "rejected" ? infoResult.reason : limitsResult.status === "rejected" ? limitsResult.reason : undefined;
      throw reason ?? new Error("Coordinator unavailable");
    }

    return {
      ...summary,
      online: true,
      loading: false,
      ...(info ? { info } : previous?.info ? { info: previous.info } : {}),
      ...(limits ? { limits } : previous?.limits ? { limits: previous.limits } : {})
    };
  } catch (error) {
    return {
      ...summary,
      ...(previous?.info ? { info: previous.info } : {}),
      ...(previous?.limits ? { limits: previous.limits } : {}),
      // Onion circuits fail transiently. Keep a recently cached health result
      // until the 30-minute cache boundary instead of flashing Offline.
      online: previous?.online ?? false,
      loading: false,
      error: toUserMessage(error, "Coordinator unavailable.")
    };
  }
}

function buildCoordinatorSummaries(settings: FederationSettings): CoordinatorSummary[] {
  return defaultFederation.map((coordinator) =>
    buildCoordinatorSummary(coordinator, {
      ...settings,
      envBaseUrl: import.meta.env.VITE_ROBOSATS_API_BASE_URL,
      hostUrl: typeof window === "undefined" ? undefined : window.location.origin
    })
  );
}

export function buildCoordinatorSummary(
  definition: CoordinatorDefinition,
  options: Parameters<typeof buildCoordinatorUrl>[1]
): CoordinatorSummary {
  const avatarAlias = defaultFederation.some((item) => item.shortAlias === definition.shortAlias) ? definition.shortAlias : "local";
  return {
    shortAlias: definition.shortAlias,
    longAlias: definition.longAlias,
    identifier: definition.identifier,
    color: definition.color,
    federated: definition.federated,
    mainnet: definition.mainnet,
    testnet: definition.testnet,
    mainnetNodesPubkeys: definition.mainnetNodesPubkeys,
    testnetNodesPubkeys: definition.testnetNodesPubkeys,
    description: definition.description,
    motto: definition.motto,
    established: definition.established,
    contact: definition.contact,
    badges: definition.badges,
    policies: definition.policies,
    nostrHexPubkey: definition.nostrHexPubkey,
    url: buildCoordinatorUrl(definition, options),
    avatarUrl: getCoordinatorAvatarUrl(avatarAlias),
    smallAvatarUrl: getCoordinatorAvatarUrl(avatarAlias, "small"),
    badgeIcons: getCoordinatorBadgeIcons(definition),
    enabled: true,
    online: false
  };
}

function readFederationSettings(): FederationSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = systemClient.getItem(FEDERATION_SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<FederationSettings>) : {};
    return {
      connection: parsed.connection === "api" ? "api" : "nostr",
      network: parsed.network === "testnet" ? "testnet" : "mainnet",
      origin: detectCoordinatorOrigin(),
      selfhostedClient: parsed.selfhostedClient === true
    };
  } catch {
    return defaultSettings;
  }
}

function persistFederationSettings(settings: FederationSettings): void {
  if (typeof window === "undefined") return;
  systemClient.setItem(FEDERATION_SETTINGS_KEY, JSON.stringify(settings));
}

function currentFederationSettings(state: FederationState): FederationSettings {
  return {
    connection: state.connection,
    network: state.network,
    origin: state.origin,
    selfhostedClient: state.selfhostedClient
  };
}

function readFederationCache(settings: FederationSettings, now = Date.now()): CachedFederation | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(FEDERATION_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<CachedFederation>;
    if (typeof cached.savedAt !== "number" || now - cached.savedAt > FEDERATION_CACHE_MAX_AGE_MS) return null;
    if (!cached.settings || !sameFederationSettings(cached.settings, settings)) return null;
    if (!Array.isArray(cached.coordinators)) return null;
    return cached as CachedFederation;
  } catch {
    return null;
  }
}

function writeFederationCache(settings: FederationSettings, coordinators: CoordinatorSummary[], savedAt = Date.now()): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    const cached: CachedFederation = {
      savedAt,
      settings,
      coordinators
    };
    storage.setItem(FEDERATION_CACHE_KEY, JSON.stringify(cached));
    persistNativeFederation(coordinators);
  } catch {
    // Cache is best-effort; private browsing and quota errors should not affect trading.
  }
}

function sameFederationSettings(left: FederationSettings, right: FederationSettings): boolean {
  return federationSettingsKey(left) === federationSettingsKey(right);
}

function federationSettingsKey(settings: FederationSettings): string {
  return [settings.connection, settings.network, settings.origin, settings.selfhostedClient ? "selfhosted" : "hosted"].join("|");
}

function getStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  return typeof window === "undefined" ? undefined : systemClient;
}

type CoordinatorPreference = { shortAlias: string; enabled: boolean; custom?: CoordinatorSummary };

function applyCoordinatorPreferences(coordinators: CoordinatorSummary[]): CoordinatorSummary[] {
  const preferences = readCoordinatorPreferences();
  const enabled = new Map(preferences.map((item) => [item.shortAlias, item.enabled]));
  const custom = preferences.flatMap((item) => item.custom ? [item.custom] : []);
  const currentFederation = coordinators.filter((item) => defaultCoordinatorAliases.has(item.shortAlias));
  return [...currentFederation, ...custom.filter((item) => !currentFederation.some((base) => base.shortAlias === item.shortAlias))]
    .map((item) => ({ ...item, enabled: enabled.get(item.shortAlias) ?? item.enabled }));
}

function readCoordinatorPreferences(): CoordinatorPreference[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(FEDERATION_PREFERENCES_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value as CoordinatorPreference[] : [];
  } catch { return []; }
}

function persistCoordinatorPreferences(coordinators: CoordinatorSummary[]) {
  const storage = getStorage();
  if (!storage) return;
  const preferences: CoordinatorPreference[] = coordinators.map((item) => ({
    shortAlias: item.shortAlias,
    enabled: item.enabled,
    ...(!defaultFederation.some((base) => base.shortAlias === item.shortAlias) ? { custom: item } : {})
  }));
  storage.setItem(FEDERATION_PREFERENCES_KEY, JSON.stringify(preferences));
  persistNativeFederation(coordinators);
}

function persistNativeFederation(coordinators: CoordinatorSummary[]): void {
  if (typeof window === "undefined") return;
  const enabled = coordinators
    .filter((coordinator) => coordinator.enabled)
    .sort((left, right) => Number(right.online) - Number(left.online));
  const relays = enabled.flatMap((coordinator) => {
    const base = coordinator.url.trim().replace(/\/$/, "");
    if (base.startsWith("https://")) return [`${base.replace(/^https:\/\//, "wss://")}/relay/`];
    if (base.startsWith("http://")) return [`${base.replace(/^http:\/\//, "ws://")}/relay/`];
    if (base.startsWith("ws://") || base.startsWith("wss://")) return [`${base}/relay/`];
    return [];
  });
  const pubkeys = enabled.flatMap((coordinator) => coordinator.nostrHexPubkey ? [coordinator.nostrHexPubkey] : []);
  systemClient.setItem("federation_relays", JSON.stringify([...new Set(relays)]));
  systemClient.setItem("federation_pubkeys", JSON.stringify([...new Set(pubkeys)]));
}

function summaryToDefinition(summary: CoordinatorSummary): CoordinatorDefinition {
  return {
    shortAlias: summary.shortAlias,
    longAlias: summary.longAlias,
    identifier: summary.identifier,
    color: summary.color,
    federated: summary.federated,
    mainnet: summary.mainnet ?? { onion: summary.url, clearnet: summary.url },
    testnet: summary.testnet ?? { onion: summary.url, clearnet: summary.url },
    mainnetNodesPubkeys: summary.mainnetNodesPubkeys,
    testnetNodesPubkeys: summary.testnetNodesPubkeys,
    description: summary.description,
    motto: summary.motto,
    established: summary.established,
    contact: summary.contact,
    badges: summary.badges,
    policies: summary.policies,
    nostrHexPubkey: summary.nostrHexPubkey
  };
}
