import { create } from "zustand";
import { deriveRobotIdentity, type RobotIdentity } from "@/domains/identity/robotIdentity";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { fetchRobot } from "@/domains/garage/robotApi";
import type { Auth } from "@/domains/transport/apiClient";
import { systemClient } from "@/domains/transport/systemClient";
import { toUserMessage } from "@/lib/userError";

const GARAGE_SLOTS_KEY = "robosats_exp_garage_slots";
const GARAGE_CURRENT_SLOT_KEY = "robosats_exp_garage_current_slot";

let robotRefreshInFlight: Promise<void> | undefined;
let robotRefreshInFlightKey = "";

export type RobotSlot = RobotIdentity & {
  nickname: string;
  activeOrderId?: number;
  lastOrderId?: number;
  earnedRewards: number;
  availableRewards?: string;
  loading?: boolean;
  robots: Record<string, RobotRecord>;
};

type GarageState = {
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
  setStealthInvoices: (token: string, shortAlias: string, enabled: boolean) => void;
  syncOrderSnapshot: (params: { token: string; shortAlias: string; orderId: number; status: number; isMaker?: boolean }) => void;
  updateSlotIdentityDetails: (
    token: string,
    details: { nickname?: string; keys?: { pubKey: string; encPrivKey: string } }
  ) => void;
  refreshRobots: (coordinators: CoordinatorSummary[]) => Promise<void>;
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
  loading?: boolean;
  error?: string;
};

type StoredRobotSlot = {
  token: string;
  nickname: string;
  robots?: Record<string, RobotRecord>;
  activeOrderId?: number;
  lastOrderId?: number;
};

export const useGarageStore = create<GarageState>((set, get) => ({
  slots: [],
  currentToken: undefined,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const rawSlots = systemClient.getItem(GARAGE_SLOTS_KEY);
    const currentToken = systemClient.getItem(GARAGE_CURRENT_SLOT_KEY) ?? undefined;
    const slots = parseStoredSlots(rawSlots);
    const nextCurrentToken = currentToken ?? slots[0]?.token;
    set({
      slots,
      currentToken: nextCurrentToken,
      hydrated: true
    });
  },
  currentSlot: () => selectCurrentSlot(get().slots, get().currentToken),
  setCurrentToken: (token) =>
    set((state) => {
      systemClient.setItem(GARAGE_CURRENT_SLOT_KEY, token);
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
  syncOrderSnapshot: ({ token, shortAlias, orderId, status, isMaker }) =>
    set((state) => {
      const renewable = status === 5 && Boolean(isMaker);
      const terminal = isTerminalOrderStatus(status) && !renewable;
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
  refreshRobots: async (coordinators) => {
    const slot = get().currentSlot();
    if (!slot || !slot.hasEnoughEntropy) return;

    // Reachability is a stale hint, not an authorization boundary. A Tor
    // coordinator may recover between federation refresh and robot refresh.
    const targets = coordinators.filter((coordinator) => coordinator.enabled && coordinator.url);
    if (targets.length === 0) return;

    const refreshKey = robotRefreshKey(slot, targets);
    if (robotRefreshInFlight && robotRefreshInFlightKey === refreshKey) return robotRefreshInFlight;

    const refresh = (async () => {
      const keys = await ensureSlotKeys(slot);
      set((state) => {
        const slots = state.slots.map((item) =>
          item.token === slot.token
            ? {
                ...item,
                loading: true,
                robots: markTargetRobotsLoading(item, targets, keys)
              }
            : item
        );
        persistSlots(slots, state.currentToken ?? slot.token);
        return { ...state, slots };
      });

      const results = await Promise.all(
        targets.map(async (coordinator) => {
          const auth: Auth = {
            tokenSHA256: slot.tokenSHA256,
            nostrPubkey: slot.nostrPubKey,
            keys: {
              pubKey: keys.pubKey,
              encPrivKey: keys.encPrivKey
            }
          };

          try {
            const snapshot = await fetchRobot(coordinator.url, auth);
            return {
              shortAlias: coordinator.shortAlias,
              orderSnapshot: {
                activeOrderId: snapshot.activeOrderId,
                lastOrderId: snapshot.lastOrderId
              },
              record: {
                token: slot.token,
                shortAlias: coordinator.shortAlias,
                tokenSHA256: slot.tokenSHA256,
                pubKey: snapshot.pubKey ?? keys.pubKey,
                encPrivKey: snapshot.encPrivKey ?? keys.encPrivKey,
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
                loading: false,
                error: snapshot.badRequest
              } satisfies RobotRecord
            };
          } catch (error) {
            const currentSlot = useGarageStore.getState().slots.find((item) => item.token === slot.token);
            const currentRobot = currentSlot?.robots[coordinator.shortAlias];
            return {
              shortAlias: coordinator.shortAlias,
              orderSnapshot: undefined,
              record: {
                ...currentRobot,
                token: slot.token,
                shortAlias: coordinator.shortAlias,
                tokenSHA256: slot.tokenSHA256,
                pubKey: keys.pubKey,
                encPrivKey: keys.encPrivKey,
                nostrPubKey: currentRobot?.nostrPubKey ?? slot.nostrPubKey,
                loading: false,
                error: toUserMessage(error, "Could not check this coordinator.")
              } satisfies RobotRecord
            };
          }
        })
      );

      set((state) => {
        const slots = state.slots.map((item) => {
          if (item.token !== slot.token) return item;
          const robots = {
            ...item.robots,
            ...Object.fromEntries(results.map((result) => {
              const currentRobot = item.robots[result.shortAlias];
              const orderState = result.orderSnapshot
                ? reconcileOrderState(
                    currentRobot,
                    result.orderSnapshot.activeOrderId,
                    result.orderSnapshot.lastOrderId
                  )
                : selectRobotOrderState(currentRobot);
              return [
                result.shortAlias,
                {
                  ...result.record,
                  ...orderState
                }
              ];
            }))
          };
          return summarizeSlot({
            ...item,
            loading: false,
            robots
          });
        });
        persistSlots(slots, state.currentToken ?? slot.token);
        return { ...state, slots };
      });
    })().finally(() => {
      if (robotRefreshInFlight === refresh) {
        robotRefreshInFlight = undefined;
        robotRefreshInFlightKey = "";
      }
    });

    robotRefreshInFlight = refresh;
    robotRefreshInFlightKey = refreshKey;
    return refresh;
  }
}));

export function selectCurrentSlot(slots: RobotSlot[], currentToken?: string): RobotSlot | undefined {
  return slots.find((slot) => slot.token === currentToken) ?? slots[0];
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
    if (!Array.isArray(parsed)) return [];
    const records = parsed.filter(isStoredRobotSlot);
    const byToken = new Map(records.map((slot) => [slot.token, slot]));
    return [...byToken.values()].map((slot) => {
        const identity = deriveRobotIdentity(slot.token);
        const robots = slot.robots ?? {};
        return summarizeSlot(
          {
            ...identity,
            nickname: slot.nickname,
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

function persistSlots(slots: RobotSlot[], currentToken: string): void {
  const stored: StoredRobotSlot[] = slots.map((slot) => ({
      token: slot.token,
      nickname: slot.nickname,
      activeOrderId: slot.activeOrderId,
      lastOrderId: slot.lastOrderId,
      robots: slot.robots
    }));
  systemClient.setItem(GARAGE_SLOTS_KEY, JSON.stringify(stored));
  systemClient.setItem(GARAGE_CURRENT_SLOT_KEY, currentToken);
}

function isStoredRobotSlot(value: unknown): value is StoredRobotSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as Partial<StoredRobotSlot>;
  return typeof slot.token === "string" && Boolean(slot.token) && typeof slot.nickname === "string";
}

async function ensureSlotKeys(slot: RobotSlot): Promise<{ pubKey: string; encPrivKey: string }> {
  const { generatePgpKeyPair, isCoordinatorCompatiblePgpKeyPair } = await import("@/domains/crypto/pgp");
  for (const robot of Object.values(slot.robots)) {
    if (robot.pubKey && robot.encPrivKey && await isCoordinatorCompatiblePgpKeyPair(robot.pubKey, robot.encPrivKey)) {
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
  const shortAlias = robots.local ? "local" : Object.keys(robots)[0] ?? "local";
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
      robots[coordinator.shortAlias] = {
        ...existingRobot,
        token: existingRobot?.token ?? slot.token,
        shortAlias: coordinator.shortAlias,
        tokenSHA256: existingRobot?.tokenSHA256 ?? slot.tokenSHA256,
        nostrPubKey: existingRobot?.nostrPubKey ?? slot.nostrPubKey,
        pubKey: keys.pubKey,
        encPrivKey: keys.encPrivKey,
        loading: true,
        error: undefined
      };
      return robots;
    },
    { ...slot.robots }
  );
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

function isTerminalOrderStatus(status: number): boolean {
  return [4, 5, 12, 14, 17, 18].includes(status);
}
