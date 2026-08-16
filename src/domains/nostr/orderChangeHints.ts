import { type Event, type Filter, verifyEvent } from "nostr-tools";
import { decrypt, getConversationKey } from "nostr-tools/nip44";
import type { SimplePool } from "nostr-tools/pool";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import {
  selectCurrentSlot,
  selectFleetManagedSlots,
  selectStandardGarageSlots,
  type RobotSlot,
  useGarageStore
} from "@/domains/garage/garageStore";
import { relayRetryDelay } from "@/domains/nostr/relayRetry";
import { getLiveRelaySubscriptions } from "@/domains/nostr/sharedRelayPool";
import {
  publishOrderChangeNotification,
  type NostrOrderChangeNotification
} from "@/domains/orders/orderChangeNotifications";
import { buildNostrRelayUrl } from "@/domains/orderbook/nostrOrderbook";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import { getNativeTorDiagnostics, isNativeApp } from "@/domains/transport/androidBridge";

export const ORDER_CHANGE_HINT_KIND = 28383;

const MAX_EVENT_AGE_SECONDS = 10 * 60;
const MAX_FUTURE_SKEW_SECONDS = 10 * 60;
const MAX_CONTENT_LENGTH = 4096;
const RECONFIGURE_DELAY_MS = 100;
const COALESCE_WINDOW_MS = 750;
const MAX_REMEMBERED_EVENTS = 2048;

type Subscription = ReturnType<SimplePool["subscribeMany"]>;

type HintTarget = {
  relay: string;
  coordinatorPubkey: string;
  shortAlias: string;
  recipients: Map<string, Uint8Array>;
};

type RuntimeDependencies = {
  pool: Pick<SimplePool, "subscribeMany">;
  now: () => number;
  canConnect: () => boolean;
  garageState: () => Pick<ReturnType<typeof useGarageStore.getState>, "slots" | "currentToken">;
  federationState: () => Pick<ReturnType<typeof useFederationStore.getState>, "coordinators">;
  proEnabled: () => boolean;
  subscribeGarage: (listener: () => void) => () => void;
  subscribeFederation: (listener: () => void) => () => void;
  subscribeProPreferences: (listener: () => void) => () => void;
  publishHint: (hint: NostrOrderChangeNotification) => void;
  eventTarget: Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;
};

let activeRuntime: OrderChangeHintRuntime | undefined;
let stopRuntime: (() => void) | undefined;

export function startOrderChangeHintRuntime(options: { suspended?: boolean } = {}): () => void {
  if (stopRuntime) {
    if (!options.suspended) activeRuntime?.start();
    return stopRuntime;
  }
  useGarageStore.getState().hydrate();
  const runtime = new OrderChangeHintRuntime(defaultDependencies());
  activeRuntime = runtime;
  if (!options.suspended) runtime.start();
  stopRuntime = () => {
    runtime.stop();
    if (activeRuntime === runtime) activeRuntime = undefined;
    stopRuntime = undefined;
  };
  return stopRuntime;
}

export function suspendOrderChangeHintRuntime(): void {
  activeRuntime?.stop();
}

export function resumeOrderChangeHintRuntime(): void {
  activeRuntime?.start();
}

export class OrderChangeHintRuntime {
  private subscriptions = new Map<string, Subscription>();
  private unsubscribeStores: Array<() => void> = [];
  private rememberedEventIds = new Set<string>();
  private lastDispatchByOrder = new Map<string, number>();
  private reconfigureTimer: number | undefined;
  private readonly targetFingerprints = new Map<string, string>();
  private readonly reconnectTimers = new Map<string, number>();
  private readonly reconnectAttempts = new Map<string, number>();
  private stopped = true;

  constructor(private readonly dependencies: RuntimeDependencies) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribeStores = [
      this.dependencies.subscribeGarage(() => this.scheduleConfigure()),
      this.dependencies.subscribeFederation(() => this.scheduleConfigure()),
      this.dependencies.subscribeProPreferences(() => this.scheduleConfigure())
    ];
    this.dependencies.eventTarget.addEventListener("online", this.onConnectivity);
    this.dependencies.eventTarget.addEventListener("robosats:tor-ready", this.onConnectivity);
    this.dependencies.eventTarget.addEventListener("robosats:tor-reconnected", this.onConnectivity);
    this.configure();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribeStores.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeStores = [];
    this.dependencies.eventTarget.removeEventListener("online", this.onConnectivity);
    this.dependencies.eventTarget.removeEventListener("robosats:tor-ready", this.onConnectivity);
    this.dependencies.eventTarget.removeEventListener("robosats:tor-reconnected", this.onConnectivity);
    if (this.reconfigureTimer !== undefined) {
      this.dependencies.eventTarget.clearTimeout(this.reconfigureTimer);
      this.reconfigureTimer = undefined;
    }
    this.clearReconnectTimers();
    this.closeSubscriptions("stopped");
  }

  private readonly onConnectivity = () => {
    this.reconnectAttempts.clear();
    this.clearReconnectTimers();
    this.scheduleConfigure(0);
  };

  private scheduleConfigure(delay = RECONFIGURE_DELAY_MS): void {
    if (this.stopped) return;
    if (this.reconfigureTimer !== undefined) {
      this.dependencies.eventTarget.clearTimeout(this.reconfigureTimer);
    }
    this.reconfigureTimer = this.dependencies.eventTarget.setTimeout(() => {
      this.reconfigureTimer = undefined;
      this.configure();
    }, delay);
  }

  private configure(): void {
    if (this.stopped) return;
    const targets = this.dependencies.canConnect() ? this.targets() : [];
    const desired = new Map(targets.map((target) => [targetKey(target), target] as const));

    for (const [key, subscription] of this.subscriptions) {
      const target = desired.get(key);
      if (target && this.targetFingerprints.get(key) === targetFingerprint(target)) continue;
      this.subscriptions.delete(key);
      this.targetFingerprints.delete(key);
      subscription.close("reconfigured");
      this.clearReconnect(key);
    }
    for (const key of this.reconnectTimers.keys()) {
      const target = desired.get(key);
      if (!target || this.targetFingerprints.get(key) !== targetFingerprint(target)) {
        this.clearReconnect(key);
      }
    }
    targets.forEach((target) => {
      const key = targetKey(target);
      const fingerprint = targetFingerprint(target);
      if (this.subscriptions.has(key) || this.reconnectTimers.has(key)) return;
      this.targetFingerprints.set(key, fingerprint);
      const filter: Filter = {
        kinds: [ORDER_CHANGE_HINT_KIND],
        authors: [target.coordinatorPubkey],
        "#p": [...target.recipients.keys()],
        since: Math.floor(this.dependencies.now() / 1000) - MAX_EVENT_AGE_SECONDS
      };
      let subscription: Subscription;
      subscription = this.dependencies.pool.subscribeMany([target.relay], filter, {
        onevent: (event) => {
          this.reconnectAttempts.delete(key);
          this.handleEvent(event, target);
        },
        oneose: () => {
          this.reconnectAttempts.delete(key);
        },
        onclose: () => {
          if (this.stopped || this.subscriptions.get(key) !== subscription) return;
          this.subscriptions.delete(key);
          this.scheduleReconnect(key);
        }
      });
      this.subscriptions.set(key, subscription);
    });
  }

  private scheduleReconnect(key: string): void {
    if (this.stopped || this.reconnectTimers.has(key)) return;
    const attempt = this.reconnectAttempts.get(key) ?? 0;
    this.reconnectAttempts.set(key, attempt + 1);
    const timer = this.dependencies.eventTarget.setTimeout(() => {
      this.reconnectTimers.delete(key);
      this.configure();
    }, relayRetryDelay(attempt));
    this.reconnectTimers.set(key, timer);
  }

  private targets(): HintTarget[] {
    const garage = this.dependencies.garageState();
    const coordinators = this.dependencies.federationState().coordinators;
    const slots = selectedSlots(garage.slots, garage.currentToken, this.dependencies.proEnabled());
    return buildHintTargets(slots, coordinators);
  }

  private handleEvent(event: Event, target: HintTarget): void {
    if (!validEnvelope(event, target, this.dependencies.now())) return;
    if (this.rememberedEventIds.has(event.id)) return;

    const recipientPubkey = event.tags.find((tag) => tag[0] === "p")?.[1]?.toLowerCase();
    if (!recipientPubkey) return;
    const secretKey = target.recipients.get(recipientPubkey);
    if (!secretKey) return;

    const payload = decryptPayload(event.content, secretKey, target.coordinatorPubkey);
    if (!payload) return;

    this.rememberEvent(event.id);
    const dispatchKey = `${target.coordinatorPubkey}:${recipientPubkey}:${payload.order_id}`;
    const now = this.dependencies.now();
    const previousDispatch = this.lastDispatchByOrder.get(dispatchKey);
    if (previousDispatch !== undefined && now - previousDispatch < COALESCE_WINDOW_MS) return;
    this.lastDispatchByOrder.set(dispatchKey, now);
    if (this.lastDispatchByOrder.size > MAX_REMEMBERED_EVENTS) {
      const oldest = this.lastDispatchByOrder.keys().next().value;
      if (oldest) this.lastDispatchByOrder.delete(oldest);
    }

    const hint: NostrOrderChangeNotification = {
      source: "nostr",
      recipientPubkey,
      coordinatorPubkey: target.coordinatorPubkey,
      shortAlias: target.shortAlias,
      orderId: payload.order_id,
      eventId: event.id,
      createdAt: event.created_at * 1000
    };
    this.dependencies.publishHint(hint);
  }

  private rememberEvent(eventId: string): void {
    this.rememberedEventIds.add(eventId);
    if (this.rememberedEventIds.size <= MAX_REMEMBERED_EVENTS) return;
    const oldest = this.rememberedEventIds.values().next().value;
    if (oldest) this.rememberedEventIds.delete(oldest);
  }

  private closeSubscriptions(reason: string): void {
    const subscriptions = [...this.subscriptions.values()];
    this.subscriptions.clear();
    this.targetFingerprints.clear();
    subscriptions.forEach((subscription) => void subscription.close(reason));
  }

  private clearReconnect(key: string): void {
    const timer = this.reconnectTimers.get(key);
    if (timer !== undefined) this.dependencies.eventTarget.clearTimeout(timer);
    this.reconnectTimers.delete(key);
    this.reconnectAttempts.delete(key);
    this.targetFingerprints.delete(key);
  }

  private clearReconnectTimers(): void {
    [...this.reconnectTimers.keys()].forEach((key) => this.clearReconnect(key));
  }
}

function defaultDependencies(): RuntimeDependencies {
  return {
    pool: getLiveRelaySubscriptions(),
    now: Date.now,
    canConnect: () => !isNativeApp() || Boolean(getNativeTorDiagnostics()?.connected),
    garageState: () => useGarageStore.getState(),
    federationState: () => useFederationStore.getState(),
    proEnabled: () => useProPreferencesStore.getState().enabled,
    subscribeGarage: (listener) => useGarageStore.subscribe(listener),
    subscribeFederation: (listener) => useFederationStore.subscribe(listener),
    subscribeProPreferences: (listener) => useProPreferencesStore.subscribe(listener),
    publishHint: publishOrderChangeNotification,
    eventTarget: window
  };
}

function selectedSlots(slots: RobotSlot[], currentToken: string | undefined, proEnabled: boolean): RobotSlot[] {
  if (proEnabled) return selectFleetManagedSlots(slots);
  const current = selectCurrentSlot(selectStandardGarageSlots(slots), currentToken);
  return current ? [current] : [];
}

export function buildHintTargets(slots: RobotSlot[], coordinators: CoordinatorSummary[]): HintTarget[] {
  const coordinatorsByAlias = new Map(
    coordinators
      .filter(
        (coordinator) =>
          coordinator.enabled && validPubkey(coordinator.nostrHexPubkey) && Boolean(buildNostrRelayUrl(coordinator))
      )
      .map((coordinator) => [coordinator.shortAlias, coordinator] as const)
  );
  const targets = new Map<string, HintTarget>();

  slots.forEach((slot) => {
    if (!validPubkey(slot.nostrPubKey)) return;
    Object.entries(slot.robots).forEach(([shortAlias, robot]) => {
      if (!robot.activeOrderId && !robot.lastOrderId && !robot.renewableOrderId) return;
      const coordinator = coordinatorsByAlias.get(shortAlias);
      if (!coordinator?.nostrHexPubkey) return;
      const relay = buildNostrRelayUrl(coordinator);
      const coordinatorPubkey = coordinator.nostrHexPubkey.toLowerCase();
      const key = `${relay}|${coordinatorPubkey}`;
      const target = targets.get(key) ?? {
        relay,
        coordinatorPubkey,
        shortAlias,
        recipients: new Map<string, Uint8Array>()
      };
      target.recipients.set(slot.nostrPubKey.toLowerCase(), slot.nostrSecKey);
      targets.set(key, target);
    });
  });

  return [...targets.values()].sort((left, right) => targetKey(left).localeCompare(targetKey(right)));
}

function validEnvelope(event: Event, target: HintTarget, nowMs: number): boolean {
  if (event.kind !== ORDER_CHANGE_HINT_KIND || !verifyEvent(event)) return false;
  if (event.pubkey.toLowerCase() !== target.coordinatorPubkey) return false;
  if (event.content.length === 0 || event.content.length > MAX_CONTENT_LENGTH) return false;
  const nowSeconds = Math.floor(nowMs / 1000);
  if (event.created_at < nowSeconds - MAX_EVENT_AGE_SECONDS) return false;
  if (event.created_at > nowSeconds + MAX_FUTURE_SKEW_SECONDS) return false;
  const recipientTags = event.tags.filter((tag) => tag[0] === "p" && validPubkey(tag[1]));
  return recipientTags.length === 1 && target.recipients.has(recipientTags[0][1].toLowerCase());
}

function decryptPayload(
  content: string,
  recipientSecretKey: Uint8Array,
  coordinatorPubkey: string
): { type: "order_changed"; version: 1; order_id: number } | undefined {
  try {
    const plaintext = decrypt(content, getConversationKey(recipientSecretKey, coordinatorPubkey));
    const value = JSON.parse(plaintext) as Record<string, unknown>;
    if (value.type !== "order_changed" || value.version !== 1) return undefined;
    if (!Number.isSafeInteger(value.order_id) || Number(value.order_id) <= 0) return undefined;
    return {
      type: "order_changed",
      version: 1,
      order_id: Number(value.order_id)
    };
  } catch {
    return undefined;
  }
}

function validPubkey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function targetKey(target: HintTarget): string {
  return `${target.relay}|${target.coordinatorPubkey}`;
}

function targetFingerprint(target: HintTarget): string {
  return `${targetKey(target)}|${[...target.recipients.keys()].sort().join(",")}`;
}
