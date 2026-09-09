import { create } from "zustand";
import { isAbortError, toUserMessage } from "@/lib/userError";
import { getCoordinatorAvatarUrl, getCoordinatorBadgeIcons } from "@/domains/coordinators/coordinatorAssets";
import {
  fetchCoordinatorFederation,
  fetchCoordinatorInfo,
  fetchCoordinatorLimits
} from "@/domains/coordinators/coordinatorApi";
import { buildCoordinatorUrl, detectCoordinatorOrigin } from "@/domains/coordinators/coordinatorUrl";
import { defaultFederation } from "@/domains/coordinators/defaultFederation";
import {
  applyBundledCoordinatorTrust,
  isFederationDocument,
  type FederationDocument
} from "@/domains/coordinators/federationDiscovery";
import type { FederationHashVote } from "@/domains/coordinators/federationConsensus";
import type {
  CoordinatorConnection,
  CoordinatorDefinition,
  CoordinatorSummary,
  Network,
  Origin
} from "@/domains/coordinators/coordinator.types";
import { systemClient } from "@/domains/transport/systemClient";
import { setTransportProbeOrigins } from "@/domains/transport/transportHealth";

type FederationState = {
  coordinators: CoordinatorSummary[];
  connection: CoordinatorConnection;
  federationDocument: FederationDocument;
  lastRefreshed?: number;
  network: Network;
  origin: Origin;
  refreshing: boolean;
  selfhostedClient: boolean;
  refreshCoordinator: (shortAlias: string, options?: FederationRefreshOptions) => Promise<boolean>;
  refreshCoordinatorLimits: (shortAlias: string, options?: FederationRefreshOptions) => Promise<boolean>;
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
  priority?: "background" | "visible";
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
const FEDERATION_MANIFEST_KEY = "federation_manifest";
const FEDERATION_JOIN_DATES_KEY = "federation_join_dates";
const defaultCoordinatorAliases = new Set(defaultFederation.map((coordinator) => coordinator.shortAlias));
const bundledFederationDocument = Object.fromEntries(
  defaultFederation.map((coordinator) => [coordinator.shortAlias, coordinator])
) as FederationDocument;
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
const initialFederationDocument = readFederationDocument();
const initialCoordinators = applyCoordinatorPreferences(
  buildCoordinatorSummaries(initialFederationDocument, initialSettings, initialCachedFederation?.coordinators)
);
persistNativeFederation(initialCoordinators);

let refreshInFlight: Promise<void> | undefined;
let refreshInFlightKey = "";
const coordinatorRefreshes = new Map<string, Promise<boolean>>();
const coordinatorLimitRefreshes = new Map<string, Promise<boolean>>();
const coordinatorRetryAfter = new Map<string, number>();
const coordinatorRetryFailures = new Map<string, number>();
const COORDINATOR_RETRY_BASE_MS = 15_000;
const COORDINATOR_RETRY_MAX_MS = 2 * 60_000;

export const useFederationStore = create<FederationState>((set, get) => ({
  coordinators: initialCoordinators,
  connection: initialSettings.connection,
  federationDocument: initialFederationDocument,
  lastRefreshed: initialCachedFederation?.savedAt,
  network: initialSettings.network,
  origin: initialSettings.origin,
  refreshing: false,
  selfhostedClient: initialSettings.selfhostedClient,
  refreshCoordinator: async (shortAlias, options = {}) => {
    const settings = currentFederationSettings(get());
    const coordinator = get().coordinators.find((item) => item.shortAlias === shortAlias);
    if (!coordinator) return false;
    const identity = coordinatorIdentity(coordinator);
    const requestKey = `${federationSettingsKey(settings)}|${shortAlias}|${identity}`;
    const existing = coordinatorRefreshes.get(requestKey);
    if (existing) return existing;
    if (!options.force && Date.now() < (coordinatorRetryAfter.get(requestKey) ?? 0)) return false;

    const refresh = (async () => {
      set((state) => ({
        coordinators: state.coordinators.map((item) =>
          item.shortAlias === shortAlias && coordinatorIdentity(item) === identity
          ? { ...item, loading: true, error: undefined }
          : item
        )
      }));

      const refreshed = await refreshCoordinatorSummary(
        summaryToDefinition(coordinator),
        settings,
        coordinator,
        options.force,
        options.priority,
        (available) => {
          if (!isCurrentCoordinator(get, settings, shortAlias, identity)) return;
          set((state) => ({
            coordinators: state.coordinators.map((item) =>
              item.shortAlias === shortAlias && coordinatorIdentity(item) === identity
              ? { ...available, enabled: item.enabled }
              : item
            )
          }));
        }
      );
      if (!refreshed) {
        if (!isCurrentCoordinator(get, settings, shortAlias, identity)) return false;
        set((state) => ({
          coordinators: state.coordinators.map((item) =>
            item.shortAlias === shortAlias && coordinatorIdentity(item) === identity
            ? { ...item, loading: false, error: coordinator.error }
            : item
          )
        }));
        return false;
      }
      if (!isCurrentCoordinator(get, settings, shortAlias, identity)) return false;

      const current = get();
      const coordinators = current.coordinators.map((item) =>
        item.shortAlias === shortAlias && coordinatorIdentity(item) === identity
        ? { ...refreshed, enabled: item.enabled }
        : item
      );
      set({ coordinators });
      writeFederationCache(settings, coordinators, current.lastRefreshed ?? Date.now());

      if (refreshed.online && !refreshed.error) {
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
  refreshCoordinatorLimits: async (shortAlias, options = {}) => {
    const settings = currentFederationSettings(get());
    const coordinator = get().coordinators.find((item) => item.shortAlias === shortAlias);
    if (!coordinator?.url) return false;
    const identity = coordinatorIdentity(coordinator);
    const requestKey = `${federationSettingsKey(settings)}|${shortAlias}|${identity}`;
    const existing = coordinatorLimitRefreshes.get(requestKey);
    if (existing) return existing;
    if (coordinator.limits && !options.force) return true;

    const refresh = (async () => {
      try {
        const limits = await fetchCoordinatorLimits(coordinator.url, {
          force: options.force,
          priority: options.priority
        });
        if (!isCurrentCoordinator(get, settings, shortAlias, identity)) return false;

        const current = get();
        const coordinators = current.coordinators.map((item) =>
          item.shortAlias === shortAlias && coordinatorIdentity(item) === identity
          ? { ...item, limits }
          : item
        );
        set({ coordinators });
        writeFederationCache(settings, coordinators, current.lastRefreshed ?? Date.now());
        return true;
      } catch {
        // Limits are optional metadata. A failed limits request must not turn a
        // reachable coordinator into an unavailable one.
        return false;
      }
    })().finally(() => coordinatorLimitRefreshes.delete(requestKey));

    coordinatorLimitRefreshes.set(requestKey, refresh);
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

    const refresh = refreshFederation(settings, set, get, options.force, options.priority).finally(() => {
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
      }, state.federationDocument)
    ),
  setNetwork: (network) =>
    set((state) =>
      applyFederationSettings({
        connection: state.connection,
        network,
        origin: state.origin,
        selfhostedClient: state.selfhostedClient
      }, state.federationDocument)
    ),
  setOrigin: (origin) =>
    set((state) =>
      applyFederationSettings({
        connection: state.connection,
        network: state.network,
        origin,
        selfhostedClient: state.selfhostedClient
      }, state.federationDocument)
    ),
  setSelfhostedClient: (selfhostedClient) =>
    set((state) =>
      applyFederationSettings({
        connection: state.connection,
        network: state.network,
        origin: state.origin,
        selfhostedClient
      }, state.federationDocument)
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
    if (state.coordinators.find((item) => item.shortAlias === shortAlias)?.federated !== false) return state;
    const coordinators = state.coordinators.filter((item) => item.shortAlias !== shortAlias);
    persistCoordinatorPreferences(coordinators);
    return { coordinators };
  })
}));

function applyFederationSettings(
  settings: FederationSettings,
  federationDocument: FederationDocument
): Partial<FederationState> {
  persistFederationSettings(settings);
  const cached = readFederationCache(settings);
  return {
    ...settings,
    coordinators: applyCoordinatorPreferences(
      buildCoordinatorSummaries(federationDocument, settings, cached?.coordinators)
    ),
    lastRefreshed: cached?.savedAt,
    refreshing: false
  };
}

async function refreshFederation(
  settings: FederationSettings,
  set: FederationSet,
  get: FederationGet,
  force = false,
  priority: "background" | "visible" = force ? "visible" : "background"
): Promise<void> {
  const current = get().coordinators.filter((coordinator) => coordinator.enabled);
  set((state) => ({
    refreshing: true,
    coordinators: state.coordinators.map((coordinator) => coordinator.enabled
      ? { ...coordinator, loading: true, error: undefined }
      : { ...coordinator, loading: false })
  }));

  let completed = 0;
  await mapWithConcurrency(current, 2, async (coordinator) => {
    const identity = coordinatorIdentity(coordinator);
    const refreshed = await refreshCoordinatorSummary(
      summaryToDefinition(coordinator),
      settings,
      coordinator,
      force,
      priority,
      (available) => {
        if (!isCurrentCoordinator(get, settings, coordinator.shortAlias, identity)) return;
        set((state) => ({
          coordinators: state.coordinators.map((item) =>
            item.shortAlias === coordinator.shortAlias && coordinatorIdentity(item) === identity
              ? { ...available, enabled: item.enabled }
              : item
          )
        }));
      }
    );
    if (!refreshed) {
      if (!isCurrentCoordinator(get, settings, coordinator.shortAlias, identity)) return;
      set((state) => ({
        coordinators: state.coordinators.map((item) =>
          item.shortAlias === coordinator.shortAlias && coordinatorIdentity(item) === identity
            ? { ...item, loading: false, error: coordinator.error }
            : item
        )
      }));
      return;
    }
    completed += 1;
    if (!isCurrentCoordinator(get, settings, coordinator.shortAlias, identity)) return;
    set((state) => {
      const coordinators = state.coordinators.map((item) =>
        item.shortAlias === coordinator.shortAlias && coordinatorIdentity(item) === identity
          ? { ...refreshed, enabled: item.enabled }
          : item
      );
      return { coordinators };
    });
  });
  if (!sameFederationSettings(currentFederationSettings(get()), settings)) return;
  let coordinators = get().coordinators.map((coordinator) => ({ ...coordinator, loading: false }));
  if (completed === 0) {
    set({ coordinators, refreshing: false });
    return;
  }
  set({ coordinators });
  // Membership discovery is optional; health results remain useful if its deferred code or storage is unavailable.
  const changedAliases = await refreshFederationDocument(settings, set, get).catch(() => []);
  if (!sameFederationSettings(currentFederationSettings(get()), settings)) return;
  coordinators = get().coordinators.map((coordinator) => ({ ...coordinator, loading: false }));
  const savedAt = Date.now();
  writeFederationCache(settings, coordinators, savedAt);
  set({ coordinators, lastRefreshed: savedAt, refreshing: false });
  changedAliases.forEach((shortAlias) => {
    void get().refreshCoordinator(shortAlias, { force: true, priority: "background" });
  });
}

async function refreshFederationDocument(
  settings: FederationSettings,
  set: FederationSet,
  get: FederationGet
): Promise<string[]> {
  const state = get();
  const { hashFederationDocument, voteOnFederationHashes } = await import(
    "@/domains/coordinators/federationConsensus"
  );
  const votes = collectFederationVotes(state.coordinators);
  const winnerHash = voteOnFederationHashes(
    votes,
    bundledFederationDocument,
    readFederationJoinDates()
  );
  if (!winnerHash || winnerHash === await hashFederationDocument(state.federationDocument)) return [];

  const voter = state.coordinators.find((coordinator) =>
    coordinator.enabled
    && coordinator.federated !== false
    && coordinator.url
    && coordinator.info?.federation_hash?.toLowerCase() === winnerHash
  );
  if (!voter) return [];

  let candidate: unknown;
  try {
    candidate = await fetchCoordinatorFederation(voter.url);
  } catch {
    return [];
  }
  if (!sameFederationSettings(currentFederationSettings(get()), settings)) return [];
  if (!isFederationDocument(candidate)) return [];
  const candidateHash = await hashFederationDocument(candidate);
  if (!sameFederationSettings(currentFederationSettings(get()), settings)) return [];
  if (candidateHash !== winnerHash) return [];

  const document = applyBundledCoordinatorTrust(candidate, bundledFederationDocument);
  const current = get().coordinators;
  const nextFederation = buildCoordinatorSummaries(document, settings, current);
  const next = applyCoordinatorPreferences([
    ...nextFederation,
    ...current.filter((coordinator) => coordinator.federated === false)
  ]);
  const changedAliases = changedFederationAliases(current, next);

  recordFederationJoinDates(document);
  persistFederationDocument(document);
  persistNativeFederation(next);
  set({ coordinators: next, federationDocument: document });
  return changedAliases;
}

function collectFederationVotes(coordinators: CoordinatorSummary[]): FederationHashVote[] {
  return coordinators.flatMap((coordinator) => {
    const hash = coordinator.info?.federation_hash?.toLowerCase();
    if (
      !coordinator.enabled
      || coordinator.federated === false
      || !coordinator.online
      || coordinator.error
      || !hash
      || !/^[0-9a-f]{64}$/.test(hash)
    ) return [];
    return [{ alias: coordinator.shortAlias, hash }];
  });
}

function changedFederationAliases(current: CoordinatorSummary[], next: CoordinatorSummary[]): string[] {
  const currentByAlias = new Map(current.map((coordinator) => [coordinator.shortAlias, coordinator]));
  return next.flatMap((coordinator) => {
    if (coordinator.federated === false) return [];
    const previous = currentByAlias.get(coordinator.shortAlias);
    return !previous || coordinatorIdentity(previous) !== coordinatorIdentity(coordinator)
      ? [coordinator.shortAlias]
      : [];
  });
}

function coordinatorIdentity(coordinator: CoordinatorSummary): string {
  return JSON.stringify([
    coordinator.url,
    coordinator.nostrHexPubkey,
    coordinator.mainnet,
    coordinator.testnet
  ]);
}

function isCurrentCoordinator(
  get: FederationGet,
  settings: FederationSettings,
  shortAlias: string,
  identity: string
): boolean {
  if (!sameFederationSettings(currentFederationSettings(get()), settings)) return false;
  const coordinator = get().coordinators.find((item) => item.shortAlias === shortAlias);
  return Boolean(coordinator && coordinatorIdentity(coordinator) === identity);
}

async function refreshCoordinatorSummary(
  definition: CoordinatorDefinition,
  settings: FederationSettings,
  previous?: CoordinatorSummary,
  force = false,
  priority: "background" | "visible" = force ? "visible" : "background",
  onAvailable?: (summary: CoordinatorSummary) => void
): Promise<CoordinatorSummary | undefined> {
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
    const info = await fetchCoordinatorInfo(summary.url, { force, priority });
    const available = {
      ...summary,
      online: true,
      lastCheckedAt: Date.now(),
      loading: false,
      info,
      ...(previous?.limits ? { limits: previous.limits } : {})
    };
    onAvailable?.(available);
    return available;
  } catch (error) {
    if (isAbortError(error)) return undefined;
    const keepRecentAvailability = hasRecentCoordinatorAvailability(previous);
    return {
      ...summary,
      ...(previous?.info ? { info: previous.info } : {}),
      ...(previous?.limits ? { limits: previous.limits } : {}),
      ...(previous?.lastCheckedAt ? { lastCheckedAt: previous.lastCheckedAt } : {}),
      // Onion circuits fail transiently. Keep a recently cached health result
      // until the 30-minute cache boundary instead of flashing Offline.
      online: keepRecentAvailability,
      loading: false,
      error: toUserMessage(error, "Coordinator unavailable.")
    };
  }
}

function hasRecentCoordinatorAvailability(summary?: CoordinatorSummary): boolean {
  if (!summary?.online || !summary.lastCheckedAt) return false;
  return Date.now() - summary.lastCheckedAt <= FEDERATION_CACHE_MAX_AGE_MS;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await task(item);
    }
  }));
}

function buildCoordinatorSummaries(
  document: FederationDocument,
  settings: FederationSettings,
  previous: CoordinatorSummary[] = []
): CoordinatorSummary[] {
  const previousByAlias = new Map(previous.map((coordinator) => [coordinator.shortAlias, coordinator]));
  return Object.values(document).map((coordinator) => {
    const summary = buildCoordinatorSummary({ ...coordinator, federated: true }, {
      ...settings,
      envBaseUrl: import.meta.env.VITE_ROBOSATS_API_BASE_URL,
      hostUrl: typeof window === "undefined" ? undefined : window.location.origin
    });
    return preserveCoordinatorRuntime(summary, previousByAlias.get(coordinator.shortAlias));
  });
}

function preserveCoordinatorRuntime(
  summary: CoordinatorSummary,
  previous?: CoordinatorSummary
): CoordinatorSummary {
  if (!previous || coordinatorIdentity(previous) !== coordinatorIdentity(summary)) return summary;
  return {
    ...summary,
    enabled: previous.enabled,
    online: previous.online,
    lastCheckedAt: previous.lastCheckedAt,
    loading: previous.loading,
    error: previous.error,
    info: previous.info,
    limits: previous.limits
  };
}

export function buildCoordinatorSummary(
  definition: CoordinatorDefinition,
  options: Parameters<typeof buildCoordinatorUrl>[1]
): CoordinatorSummary {
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
    avatarUrl: getCoordinatorAvatarUrl(definition.shortAlias),
    smallAvatarUrl: getCoordinatorAvatarUrl(definition.shortAlias, "small"),
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

function readFederationDocument(): FederationDocument {
  if (typeof window === "undefined") return bundledFederationDocument;
  try {
    const parsed = JSON.parse(systemClient.getItem(FEDERATION_MANIFEST_KEY) ?? "null") as unknown;
    if (isFederationDocument(parsed)) {
      return applyBundledCoordinatorTrust(parsed, bundledFederationDocument);
    }
  } catch {
    // A malformed or inaccessible cache never replaces the bundled trust root.
  }
  return bundledFederationDocument;
}

function persistFederationDocument(document: FederationDocument): void {
  if (typeof window === "undefined") return;
  try {
    systemClient.setItem(FEDERATION_MANIFEST_KEY, JSON.stringify(document));
  } catch {
    // The accepted in-memory document remains usable when persistence is unavailable.
  }
}

function readFederationJoinDates(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(systemClient.getItem(FEDERATION_JOIN_DATES_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([alias, value]) =>
      /^[a-z0-9]{1,20}$/.test(alias)
      && typeof value === "string"
      && !Number.isNaN(new Date(value).getTime())
    ));
  } catch {
    return {};
  }
}

function recordFederationJoinDates(document: FederationDocument, now = new Date()): void {
  if (typeof window === "undefined") return;
  const joinDates = readFederationJoinDates();
  const observed = now.toISOString().slice(0, 10);
  let changed = false;
  Object.keys(document).forEach((alias) => {
    if (!defaultCoordinatorAliases.has(alias) && !joinDates[alias]) {
      joinDates[alias] = observed;
      changed = true;
    }
  });
  if (!changed) return;
  try {
    systemClient.setItem(FEDERATION_JOIN_DATES_KEY, JSON.stringify(joinDates));
  } catch {
    // Seniority safely falls back to minimum weight if the ledger cannot be saved.
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
  const currentFederation = coordinators.filter((item) => item.federated !== false);
  const providedCustom = coordinators.filter((item) => item.federated === false);
  const storedCustom = preferences.flatMap((item) => item.custom?.federated === false ? [item.custom] : []);
  const custom = [...providedCustom, ...storedCustom].filter((item, index, all) =>
    all.findIndex((candidate) => candidate.shortAlias === item.shortAlias) === index
    && !currentFederation.some((base) => base.shortAlias === item.shortAlias)
  );
  return [...currentFederation, ...custom]
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
    ...(item.federated === false ? { custom: item } : {})
  }));
  storage.setItem(FEDERATION_PREFERENCES_KEY, JSON.stringify(preferences));
  persistNativeFederation(coordinators);
}

function persistNativeFederation(coordinators: CoordinatorSummary[]): void {
  const enabled = coordinators
    .filter((coordinator) => coordinator.enabled)
    .sort((left, right) => Number(right.online) - Number(left.online));
  setTransportProbeOrigins(enabled.map((coordinator) => coordinator.url));
  if (typeof window === "undefined") return;
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
