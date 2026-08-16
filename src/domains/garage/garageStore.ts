import { create, type StoreApi, type UseBoundStore } from "zustand";
import { deriveRobotIdentity, type RobotIdentity } from "@/domains/identity/robotIdentity";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { fetchRobot } from "@/domains/garage/robotApi";
import {
  publishRobotRefreshResult,
  type RefreshRobotCoordinatorResult,
  type RefreshRobotSlotResult
} from "@/domains/garage/robotRefreshEvents";
import type { Auth, RequestPriority, RequestSource } from "@/domains/transport/apiClient";
import { isNativeApp } from "@/domains/transport/androidBridge";
import { systemClient } from "@/domains/transport/systemClient";
import { isAbortError, toUserMessage } from "@/lib/userError";
import { isTerminalOrderForCurrentRobot } from "@/domains/orders/orderStateMachine";

export type { RefreshRobotCoordinatorResult, RefreshRobotSlotResult } from "@/domains/garage/robotRefreshEvents";

const GARAGE_SLOTS_KEY = "robosats_exp_garage_slots_v1";
const GARAGE_CURRENT_SLOT_KEY = "robosats_exp_garage_current_slot";

type RobotRefreshObserver = (result: RefreshRobotCoordinatorResult) => void;

type RobotRefreshRun = {
  promise: Promise<RefreshRobotSlotResult>;
  observers: Set<RobotRefreshObserver>;
  completed: Map<string, RefreshRobotCoordinatorResult>;
};

const robotRefreshes = new Map<string, RobotRefreshRun>();
const activeRobotRefreshSessions = new Map<string, string>();
const pendingRobotRefreshSessions = new Map<string, Set<string>>();
const slotKeyPreparations = new Map<string, Promise<{ pubKey: string; encPrivKey: string }>>();
let robotRefreshSequence = 0;
let pendingSlotsPersistence: { slots: RobotSlot[]; currentToken?: string } | undefined;
let persistenceLifecycleRegistered = false;

export type RobotSlot = RobotIdentity & {
  nickname: string;
  managedBy?: "fleet";
  activeOrderId?: number;
  lastOrderId?: number;
  earnedRewards: number;
  availableRewards?: string;
  loading?: boolean;
  robots: Record<string, RobotRecord>;
};

export type GarageState = {
  slots: RobotSlot[];
  currentToken?: string;
  hydrated: boolean;
  hydrate: () => void;
  currentSlot: () => RobotSlot | undefined;
  setCurrentToken: (token: string) => void;
  addSlot: (slot: RobotSlot) => void;
  removeSlot: (token: string) => void;
  setActiveOrder: (token: string, shortAlias: string, orderId: number) => void;
  releaseOrderReservation: (token: string, shortAlias: string, orderId: number) => void;
  acknowledgeRewardClaim: (token: string, shortAlias: string) => void;
  setStealthInvoices: (token: string, shortAlias: string, enabled: boolean) => void;
  syncOrderSnapshot: (params: {
    token: string;
    shortAlias: string;
    orderId: number;
    status: number;
    isMaker?: boolean;
    isSeller?: boolean;
  }) => void;
  updateSlotIdentityDetails: (
    token: string,
    details: { nickname?: string; keys?: { pubKey: string; encPrivKey: string } }
  ) => void;
  refreshRobotSlot: (
    token: string,
    coordinators: CoordinatorSummary[],
    options?: RefreshRobotSlotOptions
  ) => Promise<RefreshRobotSlotResult>;
  refreshRobots: (coordinators: CoordinatorSummary[]) => Promise<void>;
};

export type RefreshRobotSlotOptions = {
  priority?: RequestPriority;
  source?: RequestSource;
  preferredAliases?: string[];
  requireCompleteAvailability?: boolean;
  maxAgeMs?: number;
  onCoordinatorResult?: RobotRefreshObserver;
  supersedeInFlight?: boolean;
};

export type RobotRecord = {
  token: string;
  pubKey?: string;
  encPrivKey?: string;
  shortAlias?: string;
  nostrPubKey?: string;
  tokenSHA256?: string;
  activeOrderId?: number;
  lastOrderId?: number;
  releasedOrderId?: number;
  renewableOrderId?: number;
  earnedRewards?: number;
  stealthInvoices?: boolean;
  found?: boolean;
  lastLogin?: string;
  tgEnabled?: boolean;
  tgBotName?: string;
  tgToken?: string;
  webhookUrl?: string;
  webhookEnabled?: boolean;
  webhookApiKey?: string;
  lastCheckedAt?: number;
  loading?: boolean;
  error?: string;
};

type StoredRobotSlot = {
  token: string;
  nickname: string;
  managedBy?: "fleet";
  robots?: Record<string, RobotRecord>;
  activeOrderId?: number;
  lastOrderId?: number;
};

type StoredGarageV1 = {
  format: "robosats-exp-garage-slots";
  version: 1;
  slots: StoredRobotSlot[];
};

export const useGarageStore: UseBoundStore<StoreApi<GarageState>> = create<GarageState>((set, get) => ({
  slots: [],
  currentToken: undefined,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const rawSlots = systemClient.getItem(GARAGE_SLOTS_KEY);
    const currentToken = systemClient.getItem(GARAGE_CURRENT_SLOT_KEY) ?? undefined;
    const parsedSlots = parseStoredSlots(rawSlots);
    const slots = slotsForPersistentStorage(parsedSlots);
    const nextCurrentToken =
      currentToken && slots.some((slot) => slot.token === currentToken) ? currentToken : slots[0]?.token;
    if (slots.length !== parsedSlots.length || currentToken !== nextCurrentToken) {
      persistSlots(slots, nextCurrentToken);
    }
    set({
      slots,
      currentToken: nextCurrentToken,
      hydrated: true
    });
  },
  currentSlot: () => selectCurrentSlot(get().slots, get().currentToken),
  setCurrentToken: (token) =>
    set((state) => {
      persistCurrentToken(state.slots, token);
      return { ...state, currentToken: token };
    }),
  addSlot: (slot) => {
    if (!get().hydrated) get().hydrate();
    set((state) => {
      const slots = state.slots.some((existing) => existing.token === slot.token)
        ? state.slots.map((existing) => (existing.token === slot.token ? mergeRobotSlot(existing, slot) : existing))
        : [...state.slots, slot];
      persistSlots(slots, slot.token);
      return {
        ...state,
        slots,
        currentToken: slot.token
      };
    });
  },
  removeSlot: (token) =>
    set((state) => {
      const slots = state.slots.filter((s) => s.token !== token);
      const newCurrent = state.currentToken === token ? (slots[0]?.token ?? undefined) : state.currentToken;
      persistSlots(slots, newCurrent ?? slots[0]?.token ?? "");
      return { ...state, slots, currentToken: newCurrent };
    }),
  updateSlotIdentityDetails: (token, details) =>
    set((state) => {
      let changed = false;
      const slots = state.slots.map((slot) => {
        if (slot.token !== token) return slot;
        changed = true;
        return {
          ...slot,
          nickname: details.nickname ?? slot.nickname,
          robots: details.keys ? storeRobotKeys(slot.robots, token, details.keys) : slot.robots
        };
      });

      if (!changed) return state;
      persistSlots(slots, state.currentToken ?? token);
      return { ...state, slots };
    }),
  setActiveOrder: (token, shortAlias, orderId) =>
    set((state) => {
      const slots = state.slots.map((slot) => {
        if (slot.token !== token) return slot;
        const existingRobot = slot.robots[shortAlias] ?? Object.values(slot.robots)[0];
        return {
          ...slot,
          activeOrderId: orderId,
          robots: {
            ...slot.robots,
            [shortAlias]: {
              ...existingRobot,
              token: existingRobot?.token ?? slot.token,
              shortAlias,
              activeOrderId: orderId,
              lastOrderId: orderId,
              releasedOrderId: undefined,
              renewableOrderId: undefined
            }
          }
        };
      });
      persistSlots(slots, state.currentToken ?? token);
      return { ...state, slots };
    }),
  releaseOrderReservation: (token, shortAlias, orderId) =>
    set((state) => {
      const slots = state.slots.map((slot) => {
        if (slot.token !== token) return slot;
        const existingRobot = slot.robots[shortAlias] ?? Object.values(slot.robots)[0];
        return summarizeSlot({
          ...slot,
          robots: {
            ...slot.robots,
            [shortAlias]: {
              ...existingRobot,
              token: existingRobot?.token ?? slot.token,
              shortAlias,
              activeOrderId: existingRobot?.activeOrderId === orderId ? undefined : existingRobot?.activeOrderId,
              lastOrderId: existingRobot?.lastOrderId === orderId ? undefined : existingRobot?.lastOrderId,
              releasedOrderId: orderId,
              renewableOrderId: undefined
            }
          }
        });
      });
      persistSlots(slots, state.currentToken ?? token);
      return { ...state, slots };
    }),
  acknowledgeRewardClaim: (token, shortAlias) =>
    set((state) => {
      const slots = state.slots.map((slot) => {
        const robot = slot.robots[shortAlias];
        if (slot.token !== token || !robot || (robot.earnedRewards ?? 0) === 0) return slot;
        return summarizeSlot({
          ...slot,
          robots: {
            ...slot.robots,
            [shortAlias]: { ...robot, earnedRewards: 0 }
          }
        });
      });
      persistSlots(slots, state.currentToken ?? token);
      return { ...state, slots };
    }),
  setStealthInvoices: (token, shortAlias, enabled) =>
    set((state) => {
      const slots = state.slots.map((slot) => {
        if (slot.token !== token) return slot;
        const existingRobot = slot.robots[shortAlias] ?? Object.values(slot.robots)[0];
        return {
          ...slot,
          robots: {
            ...slot.robots,
            [shortAlias]: {
              ...existingRobot,
              token: existingRobot?.token ?? slot.token,
              shortAlias,
              stealthInvoices: enabled
            }
          }
        };
      });
      persistSlots(slots, state.currentToken ?? token);
      return { ...state, slots };
    }),
  syncOrderSnapshot: ({ token, shortAlias, orderId, status, isMaker, isSeller }) =>
    set((state) => {
      const renewable = status === 5 && Boolean(isMaker);
      const terminal = isTerminalOrderForCurrentRobot({ status, isMaker, isSeller }) && !renewable;
      const slots = state.slots.map((slot) => {
        if (slot.token !== token) return slot;
        const existingRobot = slot.robots[shortAlias] ?? Object.values(slot.robots)[0];
        const remainsReleased = status === 1 && existingRobot?.releasedOrderId === orderId;
        const nextRobot: RobotRecord = {
          ...existingRobot,
          token: existingRobot?.token ?? slot.token,
          shortAlias,
          lastOrderId: remainsReleased ? undefined : orderId,
          activeOrderId: terminal || remainsReleased ? undefined : orderId,
          releasedOrderId: remainsReleased ? orderId : undefined,
          renewableOrderId: renewable && !remainsReleased ? orderId : undefined
        };
        return summarizeSlot({
          ...slot,
          robots: {
            ...slot.robots,
            [shortAlias]: nextRobot
          }
        });
      });
      persistSlots(slots, state.currentToken ?? token);
      return { ...state, slots };
    }),
  refreshRobotSlot: async (token, coordinators, options = {}) => {
    const slot = get().slots.find((item) => item.token === token);
    if (!slot || !slot.hasEnoughEntropy) {
      return { slotId: slot?.tokenSHA256 ?? "", coordinators: [] };
    }

    // Reachability is a stale hint, not an authorization boundary. A Tor
    // coordinator may recover between federation refresh and robot refresh.
    const targets = orderRobotRefreshTargets(
      slot,
      coordinators.filter((coordinator) => coordinator.enabled && coordinator.url),
      options.preferredAliases
    );
    if (targets.length === 0) {
      return publishRobotRefreshResult({ slotId: slot.tokenSHA256, coordinators: [] });
    }

    const now = Date.now();
    const cachedResults = new Map(
      targets
        .filter((coordinator) => isRobotRefreshFresh(slot.robots[coordinator.shortAlias], options.maxAgeMs, now))
        .map((coordinator) => [coordinator.shortAlias, cachedRobotCoordinatorResult(slot, coordinator.shortAlias)])
    );
    const networkTargets = targets.filter((coordinator) => !cachedResults.has(coordinator.shortAlias));
    if (networkTargets.length === 0) {
      const coordinators = targets.map((coordinator) => cachedResults.get(coordinator.shortAlias)!);
      coordinators.forEach((result) => notifyRobotRefreshObserver(options.onCoordinatorResult, result));
      return publishRobotRefreshResult({ slotId: slot.tokenSHA256, coordinators });
    }

    const refreshKey = robotRefreshKey(slot, networkTargets);
    const existingRefresh = robotRefreshes.get(refreshKey);
    if (existingRefresh && !options.supersedeInFlight) {
      attachRobotRefreshObserver(existingRefresh, options.onCoordinatorResult);
      return existingRefresh.promise;
    }

    const run: RobotRefreshRun = {
      promise: Promise.resolve({ slotId: slot.tokenSHA256, coordinators: [] }),
      observers: new Set(),
      completed: new Map()
    };
    attachRobotRefreshObserver(run, options.onCoordinatorResult);
    cachedResults.forEach((result) => publishRobotCoordinatorResult(run, result));

    const sessions = new Map(
      networkTargets.map((coordinator) => [
        coordinator.shortAlias,
        beginRobotRefreshSession(slot.token, coordinator.shortAlias)
      ])
    );

    const refresh = (async () => {
      let keys: Awaited<ReturnType<typeof ensureSlotKeys>>;
      try {
        keys = await ensureSlotKeys(slot);
      } catch (error) {
        const canceledAliases = new Set(
          [...sessions]
            .filter(([shortAlias, sessionId]) => finishRobotRefreshSession(slot.token, shortAlias, sessionId))
            .map(([shortAlias]) => shortAlias)
        );
        if (canceledAliases.size > 0) {
          set((state) => ({
            ...state,
            slots: state.slots.map((item) =>
              item.token === slot.token
                ? {
                    ...item,
                    loading: (pendingRobotRefreshSessions.get(slot.token)?.size ?? 0) > 0,
                    robots: Object.fromEntries(
                      Object.entries(item.robots).map(([shortAlias, robot]) => [
                        shortAlias,
                        canceledAliases.has(shortAlias) ? { ...robot, loading: false } : robot
                      ])
                    )
                  }
                : item
            )
          }));
        }
        throw error;
      }
      const refreshTargets = networkTargets.filter((coordinator) =>
        ownsRobotRefreshSession(slot.token, coordinator.shortAlias, sessions.get(coordinator.shortAlias)!)
      );

      if (refreshTargets.length > 0) {
        set((state) => {
          const slots = state.slots.map((item) =>
            item.token === slot.token
              ? {
                  ...item,
                  loading: true,
                  robots: markTargetRobotsLoading(item, refreshTargets, keys)
                }
              : item
          );
          return { ...state, slots };
        });
      }

      const auth: Auth = {
        tokenSHA256: slot.tokenSHA256,
        nostrPubkey: slot.nostrPubKey,
        keys: {
          pubKey: keys.pubKey,
          encPrivKey: keys.encPrivKey
        }
      };
      const networkResults = await Promise.all(
        refreshTargets.map(async (coordinator) => {
          const sessionId = sessions.get(coordinator.shortAlias)!;
          const startingKeys = coordinatorKeysOrFallback(slot.robots[coordinator.shortAlias], keys);
          let applied = false;
          let transportFailed = false;
          try {
            const snapshot = await fetchRobot(coordinator.url, auth, undefined, {
              timeoutProfile:
                options.priority === "background" || options.priority === "maintenance" ? "background" : "interactive",
              priority: options.priority ?? "visible",
              source: options.source ?? "robot-refresh",
              supersedeInFlight: options.supersedeInFlight
            });
            applied = applyRobotRefreshResult(set, slot, coordinator.shortAlias, sessionId, {
              shortAlias: coordinator.shortAlias,
              orderSnapshot: {
                activeOrderId: snapshot.activeOrderId,
                lastOrderId: snapshot.lastOrderId
              },
              record: {
                token: slot.token,
                shortAlias: coordinator.shortAlias,
                tokenSHA256: slot.tokenSHA256,
                pubKey: snapshot.pubKey ?? startingKeys.pubKey,
                encPrivKey: snapshot.encPrivKey ?? startingKeys.encPrivKey,
                nostrPubKey: snapshot.nostrPubKey ?? slot.nostrPubKey,
                earnedRewards: snapshot.earnedRewards,
                stealthInvoices: snapshot.stealthInvoices,
                found: snapshot.found,
                lastLogin: snapshot.lastLogin,
                tgEnabled: snapshot.tgEnabled,
                tgBotName: snapshot.tgBotName,
                tgToken: snapshot.tgToken,
                webhookUrl: snapshot.webhookUrl,
                webhookEnabled: snapshot.webhookEnabled,
                webhookApiKey: snapshot.webhookApiKey,
                lastCheckedAt: Date.now(),
                loading: false,
                error: snapshot.badRequest
              } satisfies RobotRecord
            });
          } catch (error) {
            const currentSlot = useGarageStore.getState().slots.find((item) => item.token === slot.token);
            const currentRobot = currentSlot?.robots[coordinator.shortAlias];
            const currentKeys = coordinatorKeysOrFallback(currentRobot, startingKeys);
            if (isAbortError(error)) {
              applyRobotRefreshResult(set, slot, coordinator.shortAlias, sessionId, {
                shortAlias: coordinator.shortAlias,
                orderSnapshot: undefined,
                record: {
                  ...currentRobot,
                  token: slot.token,
                  shortAlias: coordinator.shortAlias,
                  tokenSHA256: slot.tokenSHA256,
                  pubKey: currentKeys.pubKey,
                  encPrivKey: currentKeys.encPrivKey,
                  nostrPubKey: currentRobot?.nostrPubKey ?? slot.nostrPubKey,
                  loading: false,
                  error: slot.robots[coordinator.shortAlias]?.error
                } satisfies RobotRecord
              });
              return undefined;
            }
            transportFailed = true;
            applied = applyRobotRefreshResult(set, slot, coordinator.shortAlias, sessionId, {
              shortAlias: coordinator.shortAlias,
              orderSnapshot: undefined,
              record: {
                ...currentRobot,
                token: slot.token,
                shortAlias: coordinator.shortAlias,
                tokenSHA256: slot.tokenSHA256,
                pubKey: currentKeys.pubKey,
                encPrivKey: currentKeys.encPrivKey,
                nostrPubKey: currentRobot?.nostrPubKey ?? slot.nostrPubKey,
                loading: false,
                error: toUserMessage(error, "Could not check this coordinator.")
              } satisfies RobotRecord
            });
          }
          if (!applied) return undefined;
          const result = robotCoordinatorRefreshResult(slot.token, coordinator.shortAlias, transportFailed);
          publishRobotCoordinatorResult(run, result);
          return result;
        })
      );
      const completedNetworkResults = networkResults.filter(
        (result): result is RefreshRobotCoordinatorResult => Boolean(result)
      );
      const resultsByAlias = new Map([
        ...cachedResults,
        ...completedNetworkResults.map((result) => [result.shortAlias, result] as const)
      ]);
      const results = targets.flatMap((coordinator) => {
        const result = resultsByAlias.get(coordinator.shortAlias);
        return result ? [result] : [];
      });

      if (results.length === 0) {
        return { slotId: slot.tokenSHA256, coordinators: [] } satisfies RefreshRobotSlotResult;
      }
      return publishRobotRefreshResult({
        slotId: slot.tokenSHA256,
        coordinators: results
      } satisfies RefreshRobotSlotResult);
    })().finally(() => {
      flushScheduledSlotsPersistence();
      if (robotRefreshes.get(refreshKey) === run) robotRefreshes.delete(refreshKey);
    });

    run.promise = refresh;
    robotRefreshes.set(refreshKey, run);
    return refresh;
  },
  refreshRobots: async (coordinators) => {
    const slot = get().currentSlot();
    if (!slot) return;
    await get().refreshRobotSlot(slot.token, coordinators);
  }
}));

export function selectCurrentSlot(slots: RobotSlot[], currentToken?: string): RobotSlot | undefined {
  return slots.find((slot) => slot.token === currentToken) ?? slots[0];
}

export function selectStandardGarageSlots(slots: RobotSlot[]): RobotSlot[] {
  return slots.filter((slot) => slot.managedBy !== "fleet");
}

export function selectFleetManagedSlots(slots: RobotSlot[]): RobotSlot[] {
  return slots.filter((slot) => slot.managedBy === "fleet");
}

export function getRobotAuthForCoordinator(slot: RobotSlot | undefined, shortAlias: string): Auth | undefined {
  if (!slot) return undefined;
  const robot = slot.robots[shortAlias] ?? Object.values(slot.robots)[0];
  const tokenSHA256 = robot?.tokenSHA256 ?? slot.tokenSHA256;
  if (!tokenSHA256) return undefined;

  if (robot?.pubKey && robot.encPrivKey && (robot.nostrPubKey ?? slot.nostrPubKey)) {
    return {
      tokenSHA256,
      nostrPubkey: robot.nostrPubKey ?? slot.nostrPubKey,
      keys: {
        pubKey: robot.pubKey,
        encPrivKey: robot.encPrivKey
      }
    };
  }

  return { tokenSHA256 };
}

function robotRefreshKey(slot: RobotSlot, coordinators: CoordinatorSummary[]): string {
  return [
    slot.tokenSHA256,
    coordinators.map((coordinator) => `${coordinator.shortAlias}:${coordinator.url}`).join(",")
  ].join("|");
}

function attachRobotRefreshObserver(run: RobotRefreshRun, observer?: RobotRefreshObserver): void {
  if (!observer || run.observers.has(observer)) return;
  run.observers.add(observer);
  for (const result of run.completed.values()) {
    try {
      observer(result);
    } catch {
      // Observers cannot turn a completed coordinator request into a failure.
    }
  }
}

function publishRobotCoordinatorResult(run: RobotRefreshRun, result: RefreshRobotCoordinatorResult): void {
  run.completed.set(result.shortAlias, result);
  for (const observer of run.observers) {
    try {
      observer(result);
    } catch {
      // Observers cannot turn a completed coordinator request into a failure.
    }
  }
}

function notifyRobotRefreshObserver(
  observer: RobotRefreshObserver | undefined,
  result: RefreshRobotCoordinatorResult
): void {
  if (!observer) return;
  try {
    observer(result);
  } catch {
    // Observers cannot turn a cached coordinator result into a failure.
  }
}

function isRobotRefreshFresh(robot: RobotRecord | undefined, maxAgeMs: number | undefined, now: number): boolean {
  return (
    typeof maxAgeMs === "number" &&
    maxAgeMs > 0 &&
    !robot?.loading &&
    !robot?.error &&
    typeof robot?.lastCheckedAt === "number" &&
    now - robot.lastCheckedAt >= 0 &&
    now - robot.lastCheckedAt < maxAgeMs
  );
}

function cachedRobotCoordinatorResult(slot: RobotSlot, shortAlias: string): RefreshRobotCoordinatorResult {
  const robot = slot.robots[shortAlias];
  return {
    shortAlias,
    cached: true,
    found: robot?.found,
    activeOrderId: robot?.activeOrderId,
    lastOrderId: robot?.lastOrderId,
    renewableOrderId: robot?.renewableOrderId,
    releasedOrderId: robot?.releasedOrderId,
    transportFailed: false
  };
}

function robotCoordinatorRefreshResult(
  token: string,
  shortAlias: string,
  transportFailed: boolean
): RefreshRobotCoordinatorResult {
  const refreshedSlot = useGarageStore.getState().slots.find((item) => item.token === token);
  const robot = refreshedSlot?.robots[shortAlias];
  return {
    shortAlias,
    found: robot?.found,
    activeOrderId: robot?.activeOrderId,
    lastOrderId: robot?.lastOrderId,
    renewableOrderId: robot?.renewableOrderId,
    releasedOrderId: robot?.releasedOrderId,
    error: robot?.error,
    transportFailed
  };
}

function orderRobotRefreshTargets(
  slot: RobotSlot,
  coordinators: CoordinatorSummary[],
  preferredAliases: string[] = []
): CoordinatorSummary[] {
  const preferred = new Map(preferredAliases.map((alias, index) => [alias, index]));
  return [...coordinators].sort((left, right) => {
    const leftRank = robotCoordinatorRank(slot.robots[left.shortAlias], preferred.has(left.shortAlias));
    const rightRank = robotCoordinatorRank(slot.robots[right.shortAlias], preferred.has(right.shortAlias));
    return (
      leftRank - rightRank ||
      (preferred.get(left.shortAlias) ?? Number.MAX_SAFE_INTEGER) -
        (preferred.get(right.shortAlias) ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

function robotCoordinatorRank(robot: RobotRecord | undefined, preferred: boolean): number {
  if (robot?.activeOrderId) return 0;
  if (robot?.renewableOrderId || robot?.lastOrderId) return 1;
  if (preferred) return 2;
  if (robot?.found) return 3;
  return 4;
}

type RobotRefreshResult = {
  shortAlias: string;
  orderSnapshot?: {
    activeOrderId?: number;
    lastOrderId?: number;
  };
  record: RobotRecord;
};

function beginRobotRefreshSession(token: string, shortAlias: string): string {
  const key = `${token}|${shortAlias}`;
  const sessionId = `${key}|${++robotRefreshSequence}`;
  const pending = pendingRobotRefreshSessions.get(token) ?? new Set<string>();
  const previous = activeRobotRefreshSessions.get(key);
  if (previous) pending.delete(previous);
  pending.add(sessionId);
  pendingRobotRefreshSessions.set(token, pending);
  activeRobotRefreshSessions.set(key, sessionId);
  return sessionId;
}

function finishRobotRefreshSession(token: string, shortAlias: string, sessionId: string): boolean {
  if (!ownsRobotRefreshSession(token, shortAlias, sessionId)) return false;
  const key = `${token}|${shortAlias}`;
  activeRobotRefreshSessions.delete(key);
  const pending = pendingRobotRefreshSessions.get(token);
  pending?.delete(sessionId);
  if (pending?.size === 0) pendingRobotRefreshSessions.delete(token);
  return true;
}

function ownsRobotRefreshSession(token: string, shortAlias: string, sessionId: string): boolean {
  return activeRobotRefreshSessions.get(`${token}|${shortAlias}`) === sessionId;
}

function applyRobotRefreshResult(
  set: StoreApi<GarageState>["setState"],
  slot: RobotSlot,
  shortAlias: string,
  sessionId: string,
  result: RobotRefreshResult
): boolean {
  if (!finishRobotRefreshSession(slot.token, shortAlias, sessionId)) return false;

  set((state) => {
    const slots = state.slots.map((item) => {
      if (item.token !== slot.token) return item;
      const currentRobot = item.robots[shortAlias];
      const startingRobot = slot.robots[shortAlias] ?? Object.values(slot.robots)[0];
      const orderState =
        result.orderSnapshot && !orderStateChanged(startingRobot, currentRobot)
          ? reconcileOrderState(currentRobot, result.orderSnapshot.activeOrderId, result.orderSnapshot.lastOrderId)
        : selectRobotOrderState(currentRobot);
      return summarizeSlot({
        ...item,
        loading: (pendingRobotRefreshSessions.get(slot.token)?.size ?? 0) > 0,
        robots: {
          ...item.robots,
          [shortAlias]: {
            ...result.record,
            ...orderState
          }
        }
      });
    });
    scheduleSlotsPersistence(slots, state.currentToken ?? slot.token);
    return { ...state, slots };
  });
  return true;
}

function orderStateChanged(before: RobotRecord | undefined, after: RobotRecord | undefined): boolean {
  return (
    before?.activeOrderId !== after?.activeOrderId ||
    before?.lastOrderId !== after?.lastOrderId ||
    before?.releasedOrderId !== after?.releasedOrderId ||
    before?.renewableOrderId !== after?.renewableOrderId
  );
}

function mergeRobotSlot(existing: RobotSlot, incoming: RobotSlot): RobotSlot {
  return summarizeSlot(
    {
      ...existing,
      ...incoming,
      activeOrderId: incoming.activeOrderId ?? existing.activeOrderId,
      lastOrderId: incoming.lastOrderId ?? existing.lastOrderId,
      robots: {
        ...existing.robots,
        ...incoming.robots
      }
    },
    { preserveOrderIds: true }
  );
}

function parseStoredSlots(rawSlots: string | null): RobotSlot[] {
  if (!rawSlots) return [];
  try {
    const parsed = JSON.parse(rawSlots) as unknown;
    const records = storedSlotRecords(parsed).filter(isStoredRobotSlot);
    const byToken = new Map(records.map((slot) => [slot.token, slot]));
    return [...byToken.values()].map((slot) => {
        const identity = deriveRobotIdentity(slot.token);
        const robots = Object.fromEntries(
        Object.entries(slot.robots ?? {}).map(([alias, robot]) => [alias, { ...robot, loading: undefined }])
        );
        return summarizeSlot(
          {
            ...identity,
            nickname: slot.nickname,
            managedBy: slot.managedBy,
            activeOrderId: slot.activeOrderId,
            lastOrderId: slot.lastOrderId,
            earnedRewards: 0,
            robots
          },
          { preserveOrderIds: true }
        );
      });
  } catch {
    return [];
  }
}

function persistSlots(slots: RobotSlot[], currentToken?: string): void {
  cancelScheduledSlotsPersistence();
  const persistedSlots = slotsForPersistentStorage(slots);
  const stored: StoredRobotSlot[] = persistedSlots.map((slot) => ({
      token: slot.token,
      nickname: slot.nickname,
      managedBy: slot.managedBy,
      activeOrderId: slot.activeOrderId,
      lastOrderId: slot.lastOrderId,
      robots: Object.fromEntries(
      Object.entries(slot.robots).map(([alias, robot]) => [alias, { ...robot, loading: undefined }])
      )
    }));
  const versioned: StoredGarageV1 = {
    format: "robosats-exp-garage-slots",
    version: 1,
    slots: stored
  };
  systemClient.setItem(GARAGE_SLOTS_KEY, JSON.stringify(versioned));
  persistCurrentToken(persistedSlots, currentToken);
}

function scheduleSlotsPersistence(slots: RobotSlot[], currentToken?: string): void {
  pendingSlotsPersistence = { slots, currentToken };
  ensurePersistenceLifecycleListeners();
}

function flushScheduledSlotsPersistence(): void {
  const pending = pendingSlotsPersistence;
  cancelScheduledSlotsPersistence();
  if (pending) persistSlots(pending.slots, pending.currentToken);
}

function cancelScheduledSlotsPersistence(): void {
  pendingSlotsPersistence = undefined;
}

function ensurePersistenceLifecycleListeners(): void {
  if (persistenceLifecycleRegistered || typeof window === "undefined" || typeof window.addEventListener !== "function")
    return;
  persistenceLifecycleRegistered = true;
  window.addEventListener("pagehide", flushScheduledSlotsPersistence);
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushScheduledSlotsPersistence();
      }
    });
  }
}

function slotsForPersistentStorage(slots: RobotSlot[]): RobotSlot[] {
  return isNativeApp() ? slots : selectStandardGarageSlots(slots);
}

function persistCurrentToken(slots: RobotSlot[], currentToken?: string): void {
  const persistedSlots = slotsForPersistentStorage(slots);
  const requested = persistedSlots.find((slot) => slot.token === currentToken)?.token;
  const previous = systemClient.getItem(GARAGE_CURRENT_SLOT_KEY);
  const retained = persistedSlots.find((slot) => slot.token === previous)?.token;
  const persistentToken = requested ?? retained ?? persistedSlots[0]?.token;
  if (persistentToken) {
    systemClient.setItem(GARAGE_CURRENT_SLOT_KEY, persistentToken);
  } else {
    systemClient.deleteItem(GARAGE_CURRENT_SLOT_KEY);
  }
}

function storedSlotRecords(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const stored = value as Partial<StoredGarageV1>;
  return stored.format === "robosats-exp-garage-slots" && stored.version === 1 && Array.isArray(stored.slots)
    ? stored.slots
    : [];
}

function isStoredRobotSlot(value: unknown): value is StoredRobotSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as Partial<StoredRobotSlot>;
  return (
    typeof slot.token === "string" &&
    Boolean(slot.token) &&
    typeof slot.nickname === "string" &&
    (slot.managedBy === undefined || slot.managedBy === "fleet")
  );
}

function ensureSlotKeys(slot: RobotSlot): Promise<{ pubKey: string; encPrivKey: string }> {
  const preparationKey = slot.tokenSHA256 || slot.token;
  const existing = slotKeyPreparations.get(preparationKey);
  if (existing) return existing;

  const preparation = prepareSlotKeys(slot);
  slotKeyPreparations.set(preparationKey, preparation);
  const clear = () => {
    if (slotKeyPreparations.get(preparationKey) === preparation) slotKeyPreparations.delete(preparationKey);
  };
  void preparation.then(clear, clear);
  return preparation;
}

async function prepareSlotKeys(slot: RobotSlot): Promise<{ pubKey: string; encPrivKey: string }> {
  const { generatePgpKeyPair, isCoordinatorCompatiblePgpKeyPair } = await import("@/domains/crypto/pgp");
  for (const robot of Object.values(slot.robots)) {
    if (robot.pubKey && robot.encPrivKey && (await isCoordinatorCompatiblePgpKeyPair(robot.pubKey, robot.encPrivKey))) {
      return { pubKey: robot.pubKey, encPrivKey: robot.encPrivKey };
    }
  }

  const generated = await generatePgpKeyPair(slot.token);
  const keys = {
    pubKey: generated.publicKeyArmored,
    encPrivKey: generated.encryptedPrivateKeyArmored
  };
  useGarageStore.getState().updateSlotIdentityDetails(slot.token, { keys });
  return keys;
}

function storeRobotKeys(
  robots: Record<string, RobotRecord>,
  token: string,
  keys: { pubKey: string; encPrivKey: string }
): Record<string, RobotRecord> {
  const shortAlias = robots.local ? "local" : (Object.keys(robots)[0] ?? "local");
  const existing = robots[shortAlias];
  return {
    ...robots,
    [shortAlias]: {
      ...existing,
      token: existing?.token ?? token,
      shortAlias: existing?.shortAlias ?? shortAlias,
      pubKey: keys.pubKey,
      encPrivKey: keys.encPrivKey
    }
  };
}

function markTargetRobotsLoading(
  slot: RobotSlot,
  coordinators: CoordinatorSummary[],
  keys: { pubKey: string; encPrivKey: string }
): Record<string, RobotRecord> {
  return coordinators.reduce<Record<string, RobotRecord>>(
    (robots, coordinator) => {
      const existingRobot = robots[coordinator.shortAlias] ?? Object.values(robots)[0];
      const retainedKeys = coordinatorKeysOrFallback(slot.robots[coordinator.shortAlias], keys);
      robots[coordinator.shortAlias] = {
        ...existingRobot,
        token: existingRobot?.token ?? slot.token,
        shortAlias: coordinator.shortAlias,
        tokenSHA256: existingRobot?.tokenSHA256 ?? slot.tokenSHA256,
        nostrPubKey: existingRobot?.nostrPubKey ?? slot.nostrPubKey,
        pubKey: retainedKeys.pubKey,
        encPrivKey: retainedKeys.encPrivKey,
        loading: true,
        error: undefined
      };
      return robots;
    },
    { ...slot.robots }
  );
}

function coordinatorKeysOrFallback(
  robot: RobotRecord | undefined,
  fallback: { pubKey: string; encPrivKey: string }
): { pubKey: string; encPrivKey: string } {
  return robot?.pubKey && robot.encPrivKey
    ? { pubKey: robot.pubKey, encPrivKey: robot.encPrivKey }
    : fallback;
}

function reconcileOrderState(
  robot: RobotRecord | undefined,
  activeOrderId: number | undefined,
  lastOrderId: number | undefined
): Pick<RobotRecord, "activeOrderId" | "lastOrderId" | "releasedOrderId" | "renewableOrderId"> {
  const releasedOrderId = robot?.releasedOrderId;
  if (releasedOrderId && (activeOrderId === releasedOrderId || lastOrderId === releasedOrderId)) {
    return {
      activeOrderId: activeOrderId === releasedOrderId ? undefined : activeOrderId,
      lastOrderId: lastOrderId === releasedOrderId ? undefined : lastOrderId,
      releasedOrderId,
      renewableOrderId: undefined
    };
  }

  const renewableOrderId = robot?.renewableOrderId;
  if (renewableOrderId && !activeOrderId && lastOrderId === renewableOrderId) {
    return { activeOrderId: renewableOrderId, lastOrderId, releasedOrderId: undefined, renewableOrderId };
  }

  return { activeOrderId, lastOrderId, releasedOrderId: undefined, renewableOrderId: undefined };
}

function selectRobotOrderState(
  robot: RobotRecord | undefined
): Pick<RobotRecord, "activeOrderId" | "lastOrderId" | "releasedOrderId" | "renewableOrderId"> {
  return {
    activeOrderId: robot?.activeOrderId,
    lastOrderId: robot?.lastOrderId,
    releasedOrderId: robot?.releasedOrderId,
    renewableOrderId: robot?.renewableOrderId
  };
}

function summarizeSlot(slot: RobotSlot, options: { preserveOrderIds?: boolean } = {}): RobotSlot {
  const robots = Object.values(slot.robots);
  const activeRobot = robots.find((robot) => Boolean(robot.activeOrderId));
  const lastRobot = robots.find((robot) => Boolean(robot.lastOrderId));
  const rewardRobot = robots.find((robot) => (robot.earnedRewards ?? 0) > 0);
  const earnedRewards = robots.reduce((total, robot) => total + (robot.earnedRewards ?? 0), 0);
  const firstRobot = robots[0];

  return {
    ...slot,
    tokenSHA256: slot.tokenSHA256 || firstRobot?.tokenSHA256 || "",
    nostrPubKey: slot.nostrPubKey || firstRobot?.nostrPubKey || "",
    activeOrderId: activeRobot?.activeOrderId ?? (options.preserveOrderIds ? slot.activeOrderId : undefined),
    lastOrderId: lastRobot?.lastOrderId ?? (options.preserveOrderIds ? slot.lastOrderId : undefined),
    earnedRewards,
    availableRewards: rewardRobot?.shortAlias
  };
}
