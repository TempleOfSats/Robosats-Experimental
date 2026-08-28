import { type Event, type Filter, verifyEvent } from "nostr-tools";
import type { SimplePool } from "nostr-tools/pool";
import type { CoordinatorSummary, Network } from "@/domains/coordinators/coordinator.types";
import { recordRelayPerformance } from "@/domains/diagnostics/networkPerformance";
import { getLiveRelaySubscriptions } from "@/domains/nostr/sharedRelayPool";
import {
  noteRelayEose,
  noteRelayEvent,
  noteRelayFailure,
  orderRelays,
  relayHealthSnapshot
} from "@/domains/nostr/relayHealth";
import { relayRetryDelay } from "@/domains/nostr/relayRetry";
import { currencyIdFromCode } from "@/domains/orderbook/currencies";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { decodeGeohashCenter } from "@/domains/location/f2fLocation";

const ORDER_KIND = 38383;
const SNAPSHOT_LOOKBACK_SECONDS = 30 * 60 * 60;
const RELAY_MAX_WAIT_MS = 45_000;
const PROGRESS_EMIT_INTERVAL_MS = 350;
const DEFAULT_RELAY_COUNT = 3;
const DEFAULT_PRIMARY_SILENCE_MS = 15_000;
const MIN_PRIMARY_SILENCE_MS = 12_000;
const MAX_PRIMARY_SILENCE_MS = 30_000;
const MIN_SECONDARY_SILENCE_MS = 30_000;
const MAX_SECONDARY_SILENCE_MS = 45_000;
const SESSION_IDLE_TIMEOUT_MS = 120000;
const RELAY_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_RETAINED_EVENTS = 5_000;
const RETAINED_EVENTS_AFTER_COMPACTION = 4_000;

export interface NostrOrderbookOptions {
  hostUrl?: string;
  maxWaitMs?: number;
  nowSeconds?: number;
  onOrders?: (orders: PublicOrder[], meta: NostrOrderbookSnapshotMeta) => void;
}

interface NostrOrderbookSnapshotMeta {
  partial: boolean;
  authoritative: boolean;
}

interface ParsedNostrOrder {
  dTag: string;
  publicOrder: PublicOrder | null;
  appliesToNetwork: boolean;
}

type NostrOrderbookListener = (orders: PublicOrder[], meta: NostrOrderbookSnapshotMeta) => void;

let sharedSession: NostrOrderbookSession | undefined;
let sessionSuspended = false;
const relaySelectionCache = new Map<string, string[]>();
const relayFailureUntil = new Map<string, number>();

export async function fetchNostrOrderbook(
  coordinators: CoordinatorSummary[],
  network: Network,
  options: NostrOrderbookOptions = {}
): Promise<PublicOrder[]> {
  if (sessionSuspended) throw suspendedOrderbookError();
  const session = getNostrOrderbookSession(coordinators, network, options);
  const unsubscribe = options.onOrders ? session.subscribe(options.onOrders) : undefined;
  try {
    return await session.start();
  } finally {
    unsubscribe?.();
  }
}

/**
 * Reuses the app's host-first session. Prewarm populates it before the Offers
 * page opens; the page then receives cached events immediately and keeps the
 * selected relay alive for current add/cancel events.
 */
export function subscribeNostrOrderbook(
  coordinators: CoordinatorSummary[],
  network: Network,
  options: NostrOrderbookOptions = {}
): () => void {
  if (sessionSuspended) return () => undefined;
  try {
    const session = getNostrOrderbookSession(coordinators, network, options);
    const unsubscribe = options.onOrders ? session.subscribe(options.onOrders) : () => undefined;
    void session.start().catch(() => undefined);
    return unsubscribe;
  } catch {
    options.onOrders?.([], { partial: true, authoritative: false });
    return () => undefined;
  }
}

export function resetNostrOrderbookSession(): void {
  sharedSession?.close();
}

export function suspendNostrOrderbookSession(): void {
  sessionSuspended = true;
  sharedSession?.close(suspendedOrderbookError());
}

export function resumeNostrOrderbookSession(): void {
  sessionSuspended = false;
}

function suspendedOrderbookError(): DOMException {
  return new DOMException("Nostr orderbook is suspended", "AbortError");
}

function getNostrOrderbookSession(
  coordinators: CoordinatorSummary[],
  network: Network,
  options: NostrOrderbookOptions
): NostrOrderbookSession {
  const targets = coordinators.filter(
    (coordinator) => coordinator.enabled && coordinator.nostrHexPubkey && buildNostrRelayUrl(coordinator)
  );
  const relays = selectNostrRelays(targets, options.hostUrl);
  const authors = unique(targets.map((coordinator) => coordinator.nostrHexPubkey).filter(isString)).sort();

  if (relays.length === 0 || authors.length === 0) {
    throw new Error("No Nostr relay URLs are configured for the selected coordinators.");
  }

  const reconcileAfterInitial = !relayMatchesHost(relays[0], options.hostUrl);
  const key = `${network}|${relays.join("|")}|${authors.join("|")}|${reconcileAfterInitial ? "reconcile" : "host"}`;
  if (!sharedSession || sharedSession.key !== key) {
    sharedSession?.close();
    sharedSession = new NostrOrderbookSession({
      key,
      relays,
      authors,
      coordinators: targets,
      network,
      reconcileAfterInitial,
      maxWaitMs: options.maxWaitMs ?? RELAY_MAX_WAIT_MS,
      nowSeconds: options.nowSeconds
    });
  }

  return sharedSession;
}

class NostrOrderbookSession {
  readonly key: string;
  private readonly pool = getLiveRelaySubscriptions();
  private readonly filters: Filter[];
  private readonly listeners = new Set<NostrOrderbookListener>();
  private readonly events = new Map<string, Event>();
  private readonly relayEoses = new Map<number, Set<number>>();
  private readonly closedRelays = new Set<number>();
  private readonly subscriptions = new Map<string, ReturnType<SimplePool["subscribeMany"]>>();
  private readonly fallbackTimers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly relayStartedAt = new Map<number, number>();
  private readonly relaysWithEvents = new Set<string>();
  private readonly relayRetryTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly relayRetryAttempts = new Map<number, number>();
  private readonly degradedSilentRelays = new Set<number>();
  private readonly maxWaitMs: number;
  private readonly coordinators: CoordinatorSummary[];
  private readonly network: Network;
  private readonly relays: string[];
  private readonly reconcileAfterInitial: boolean;
  private readonly primarySilenceMs: number;
  private readonly secondarySilenceMs: number;
  private started = false;
  private initialSettled = false;
  private receivedUsefulEvent = false;
  private closed = false;
  private startedAt = 0;
  private initialPromise?: Promise<PublicOrder[]>;
  private resolveInitial?: (orders: PublicOrder[]) => void;
  private rejectInitial?: (reason?: unknown) => void;
  private finalTimer?: ReturnType<typeof setTimeout>;
  private emitTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor({
    key,
    relays,
    authors,
    coordinators,
    network,
    reconcileAfterInitial,
    maxWaitMs,
    nowSeconds
  }: {
    key: string;
    relays: string[];
    authors: string[];
    coordinators: CoordinatorSummary[];
    network: Network;
    reconcileAfterInitial: boolean;
    maxWaitMs: number;
    nowSeconds?: number;
  }) {
    this.key = key;
    this.relays = relays;
    this.coordinators = coordinators;
    this.network = network;
    this.reconcileAfterInitial = reconcileAfterInitial;
    this.maxWaitMs = maxWaitMs;
    const fallbackTiming = relayFallbackTiming(relays[0]);
    this.primarySilenceMs = Math.min(fallbackTiming.primaryMs, maxWaitMs);
    this.secondarySilenceMs = Math.min(fallbackTiming.secondaryMs, maxWaitMs);
    const since = nowSeconds ?? Math.floor(Date.now() / 1000);
    this.filters = [
      {
        authors,
        kinds: [ORDER_KIND],
        since: since - SNAPSHOT_LOOKBACK_SECONDS,
        until: since
      },
      { authors, kinds: [ORDER_KIND], "#s": ["pending", "success", "canceled", "in-progress"], since }
    ];
  }

  start(): Promise<PublicOrder[]> {
    this.cancelIdleClose();
    if (this.initialPromise) return this.initialPromise;

    this.started = true;
    this.startedAt = Date.now();
    this.initialPromise = new Promise((resolve, reject) => {
      this.resolveInitial = resolve;
      this.rejectInitial = reject;
    });
    this.startRelay(0);
    this.scheduleFallback(1, this.primarySilenceMs);
    this.scheduleFallback(2, this.secondarySilenceMs);
    this.finalTimer = setTimeout(() => {
      const orders = this.currentOrders();
      const completedRelayCount = this.completedRelayCount();
      const requiredConfirmations = orders.length > 0 ? 1 : this.requiredEmptyConfirmations();
      this.finishInitial(orders, completedRelayCount >= requiredConfirmations);
    }, this.maxWaitMs);
    return this.initialPromise;
  }

  subscribe(listener: NostrOrderbookListener): () => void {
    this.cancelIdleClose();
    this.listeners.add(listener);
    if (this.started) {
      listener(this.currentOrders(), {
        partial: !this.initialSettled,
        authoritative: this.initialSettled
      });
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.scheduleIdleClose();
    };
  }

  close(error?: Error): void {
    if (this.closed) return;
    if (!this.initialSettled && this.resolveInitial) {
      this.initialSettled = true;
      if (error) this.rejectInitial?.(error);
      else this.resolveInitial(this.currentOrders());
      this.resolveInitial = undefined;
      this.rejectInitial = undefined;
    }
    this.closed = true;
    this.clearTimers();
    this.subscriptions.forEach((subscription) => void subscription.close("complete"));
    this.subscriptions.clear();
    this.listeners.clear();
    if (sharedSession === this) sharedSession = undefined;
  }

  private startRelay(relayIndex: number): void {
    if (this.closed || relayIndex >= this.relays.length || this.relayEoses.has(relayIndex)) return;
    this.relayEoses.set(relayIndex, new Set());
    const relay = this.relays[relayIndex];
    this.relayStartedAt.set(relayIndex, Date.now());
    recordRelayPerformance(relay, "connect", 0);
    this.startRelayFilter(relayIndex, 0);
  }

  private startRelayFilter(relayIndex: number, filterIndex: number): void {
    if (this.closed || this.relayEoses.get(relayIndex)?.has(filterIndex)) return;
    const relay = this.relays[relayIndex];
    const filter = this.filters[filterIndex];
    if (!relay || !filter) return;
    const subscriptionKey = `${relayIndex}:${filterIndex}`;
    if (this.subscriptions.has(subscriptionKey)) return;
    const subscription = this.pool.subscribeMany([relay], filter, {
      id: `robosats-orderbook-${Date.now()}-${relayIndex}-${filterIndex}`,
      maxWait: this.maxWaitMs,
      onevent: (event) => this.handleEvent(event, relay),
      oneose: () => this.markEose(relayIndex, filterIndex, subscriptionKey),
      onclose: () => this.handleRelayClose(relayIndex, relay, filterIndex, subscriptionKey)
    });
    this.subscriptions.set(subscriptionKey, subscription);
  }

  private scheduleFallback(relayIndex: number, delayMs: number, onlyWhenEmpty = false): void {
    if (relayIndex >= this.relays.length) return;
    const timer = setTimeout(() => {
      if (onlyWhenEmpty && this.events.size > 0) return;
      this.degradeSilentRelaysBefore(relayIndex);
      this.startRelay(relayIndex);
    }, delayMs);
    this.fallbackTimers.push(timer);
  }

  private degradeSilentRelaysBefore(fallbackRelayIndex: number): void {
    for (let relayIndex = 0; relayIndex < fallbackRelayIndex; relayIndex += 1) {
      if (
        this.degradedSilentRelays.has(relayIndex) ||
        !this.relayStartedAt.has(relayIndex) ||
        this.relayEoses.get(relayIndex)?.size
      ) {
        continue;
      }

      const relay = this.relays[relayIndex];
      if (!relay || this.relaysWithEvents.has(relay)) continue;
      this.degradedSilentRelays.add(relayIndex);
      markRelayUnavailable(relay);
      noteRelayFailure(relay);
      recordRelayPerformance(
        relay,
        "close",
        Date.now() - (this.relayStartedAt.get(relayIndex) ?? Date.now()),
        "timeout"
      );
    }
  }

  private handleEvent(event: Event, relay: string): void {
    if (this.closed || this.events.has(event.id) || !verifyEvent(event)) return;
    const relayIndex = this.relays.indexOf(relay);
    if (relayIndex >= 0) this.relayRetryAttempts.delete(relayIndex);
    noteRelayEvent(relay);
    if (!this.relaysWithEvents.has(relay)) {
      this.relaysWithEvents.add(relay);
      recordRelayPerformance(relay, "first-event", Date.now() - (this.relayStartedAt.get(relayIndex) ?? Date.now()));
    }
    this.events.set(event.id, event);
    if (this.events.size > MAX_RETAINED_EVENTS) {
      const retained = compactNostrOrderbookEvents(
        [...this.events.values()],
        Math.floor(Date.now() / 1000),
        RETAINED_EVENTS_AFTER_COMPACTION
      );
      this.events.clear();
      retained.forEach((item) => this.events.set(item.id, item));
    }
    if (!this.receivedUsefulEvent) {
      this.receivedUsefulEvent = true;
      this.clearFallbackTimers();
      const nextRelay = this.relays.findIndex((_candidate, index) => !this.relayEoses.has(index));
      if (nextRelay >= 0) {
        const elapsedMs = Date.now() - this.startedAt;
        const remainingBeforeUsefulFallback = this.maxWaitMs - elapsedMs - MIN_PRIMARY_SILENCE_MS;
        this.scheduleFallback(nextRelay, Math.min(this.primarySilenceMs, Math.max(0, remainingBeforeUsefulFallback)));
      }
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined;
      const orders = this.currentOrders();
      this.emit(!this.initialSettled, this.initialSettled, orders);
    }, PROGRESS_EMIT_INTERVAL_MS);
  }

  private markEose(relayIndex: number, filterIndex: number, subscriptionKey: string): void {
    if (this.closed) return;
    this.relayRetryAttempts.delete(relayIndex);
    const completedFilters = this.relayEoses.get(relayIndex);
    if (!completedFilters) return;
    completedFilters.add(filterIndex);
    if (filterIndex === 0) {
      const closeResult = this.subscriptions.get(subscriptionKey)?.close("snapshot-complete");
      this.subscriptions.delete(subscriptionKey);
      void Promise.resolve(closeResult).finally(() => this.startRelayFilter(relayIndex, 1));
    }
    if (this.initialSettled) return;
    if (completedFilters.size !== this.filters.length) return;
    const relay = this.relays[relayIndex];
    markRelayHealthy(relay);
    noteRelayEose(relay, Date.now() - (this.relayStartedAt.get(relayIndex) ?? Date.now()));
    recordRelayPerformance(relay, "eose", Date.now() - (this.relayStartedAt.get(relayIndex) ?? Date.now()));

    const orders = this.currentOrders();
    if (orders.length > 0) {
      this.finishInitial(orders, true);
      return;
    }

    const nextRelay = this.relays.findIndex((_relay, index) => !this.relayEoses.has(index));
    if (nextRelay >= 0) this.startRelay(nextRelay);

    if (this.completedRelayCount() >= this.requiredEmptyConfirmations()) {
      this.finishInitial(orders, true);
    }
  }

  private handleRelayClose(relayIndex: number, relay: string, filterIndex: number, subscriptionKey: string): void {
    this.subscriptions.delete(subscriptionKey);
    if (filterIndex === 0 && this.relayEoses.get(relayIndex)?.has(filterIndex)) return;
    if (this.closed || this.closedRelays.has(relayIndex)) return;
    this.closedRelays.add(relayIndex);
    markRelayUnavailable(relay);
    noteRelayFailure(relay);
    recordRelayPerformance(
      relay,
      "close",
      Date.now() - (this.relayStartedAt.get(relayIndex) ?? Date.now()),
      "network-error"
    );

    // EOSE completes the initial snapshot but the subscription remains the
    // live update channel. Replace it even when the initial fetch has settled.
    const nextRelay = this.relays.findIndex((_candidate, index) => index > relayIndex && !this.relayEoses.has(index));
    if (nextRelay >= 0) this.startRelay(nextRelay);
    this.scheduleRelayReconnect(relayIndex);
  }

  private scheduleRelayReconnect(relayIndex: number): void {
    if (this.closed || this.relayRetryTimers.has(relayIndex)) return;
    const attempt = this.relayRetryAttempts.get(relayIndex) ?? 0;
    this.relayRetryAttempts.set(relayIndex, attempt + 1);
    const timer = setTimeout(() => {
      this.relayRetryTimers.delete(relayIndex);
      if (this.closed) return;
      this.closedRelays.delete(relayIndex);
      this.relayEoses.delete(relayIndex);
      this.startRelay(relayIndex);
    }, relayRetryDelay(attempt));
    this.relayRetryTimers.set(relayIndex, timer);
  }

  private finishInitial(orders = this.currentOrders(), authoritative = true): void {
    if (this.closed || this.initialSettled) return;
    this.initialSettled = true;
    if (this.finalTimer) clearTimeout(this.finalTimer);
    this.clearFallbackTimers();
    if (authoritative && orders.length > 0) {
      const unopened = this.relays.map((_relay, index) => index).filter((index) => !this.relayEoses.has(index));
      if (unopened[0] !== undefined) {
        this.scheduleFallback(
          unopened[0],
          this.reconcileAfterInitial ? this.primarySilenceMs : this.secondarySilenceMs
        );
      }
    }
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = undefined;
    }
    this.emit(!authoritative, authoritative, orders);
    this.resolveInitial?.(orders);
    this.resolveInitial = undefined;
    this.rejectInitial = undefined;
    if (this.listeners.size === 0) this.scheduleIdleClose();
  }

  private currentOrders(): PublicOrder[] {
    return nostrEventsToPublicOrders([...this.events.values()], this.coordinators, this.network);
  }

  private emit(partial: boolean, authoritative: boolean, orders = this.currentOrders()): void {
    this.listeners.forEach((listener) => listener(orders, { partial, authoritative }));
  }

  private completedRelayCount(): number {
    return [...this.relayEoses.values()].filter((filters) => filters.size === this.filters.length).length;
  }

  private requiredEmptyConfirmations(): number {
    return Math.min(2, this.relays.length);
  }

  private scheduleIdleClose(): void {
    if (this.idleTimer || this.closed) return;
    this.idleTimer = setTimeout(() => this.close(), SESSION_IDLE_TIMEOUT_MS);
  }

  private cancelIdleClose(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private clearTimers(): void {
    if (this.finalTimer) clearTimeout(this.finalTimer);
    if (this.emitTimer) clearTimeout(this.emitTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.clearFallbackTimers();
    this.relayRetryTimers.forEach((timer) => clearTimeout(timer));
    this.relayRetryTimers.clear();
  }

  private clearFallbackTimers(): void {
    this.fallbackTimers.forEach((timer) => clearTimeout(timer));
    this.fallbackTimers.length = 0;
  }
}

export function nostrEventsToPublicOrders(
  events: Event[],
  coordinators: CoordinatorSummary[],
  network: Network
): PublicOrder[] {
  const orders = new Map<string, PublicOrder>();

  [...events]
    .sort((left, right) => left.created_at - right.created_at)
    .forEach((event) => {
      const parsed = nostrEventToPublicOrder(event, coordinators, network);
      if (!parsed.dTag || !parsed.appliesToNetwork) return;

      if (parsed.publicOrder) {
        orders.set(parsed.dTag, parsed.publicOrder);
      } else {
        orders.delete(parsed.dTag);
      }
    });

  return [...orders.values()];
}

export function compactNostrOrderbookEvents(
  events: Event[],
  nowSeconds: number,
  limit = RETAINED_EVENTS_AFTER_COMPACTION
): Event[] {
  const cutoff = nowSeconds - SNAPSHOT_LOOKBACK_SECONDS;
  const latest = new Map<string, Event>();

  events.forEach((event) => {
    if (event.created_at < cutoff) return;
    const dTag = tagValue(event, "d");
    if (!dTag) return;
    const network = tagValue(event, "network") ?? "";
    const key = `${event.pubkey}:${event.kind}:${network}:${dTag}`;
    const current = latest.get(key);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    ) {
      latest.set(key, event);
    }
  });

  return [...latest.values()]
    .sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))
    .slice(0, Math.max(1, limit));
}

export function nostrEventToPublicOrder(
  event: Event,
  coordinators: CoordinatorSummary[],
  network: Network
): ParsedNostrOrder {
  const dTag = tagValue(event, "d") ?? "";
  const eventNetwork = tagValue(event, "network") ?? "";
  const appliesToNetwork = eventNetwork === network;
  const coordinator = coordinators.find((item) => item.nostrHexPubkey === event.pubkey);

  if (!appliesToNetwork) return { dTag, publicOrder: null, appliesToNetwork: false };
  if (!coordinator || tagValue(event, "s") !== "pending") {
    return { dTag, publicOrder: null, appliesToNetwork: true };
  }

  const platform = tag(event, "y");
  const source = tagValue(event, "source") ?? "";
  const currencyCode = tagValue(event, "f") ?? "";
  const currency = currencyIdFromCode(currencyCode);
  const orderId = parseOrderId(source, dTag, platform?.[1] === "robosats");

  if (!currency || !orderId) {
    return { dTag, publicOrder: null, appliesToNetwork: true };
  }

  const fiatAmount = tag(event, "fa");
  const hasRange = Boolean(fiatAmount?.[2]);
  const name = tag(event, "name");
  const makerHashId = name?.[2] || `${orderId}${coordinator.shortAlias}`;
  const bondSizePercent = toOptionalNumber(tagValue(event, "bond"));
  const expiration = toOptionalNumber(tagValue(event, "expiration"));
  const approximateLocation = decodeGeohashCenter(tagValue(event, "g") ?? "");

  return {
    dTag,
    appliesToNetwork: true,
    publicOrder: {
      id: orderId,
      created_at: new Date(event.created_at * 1000).toISOString(),
      ...(expiration ? { expires_at: new Date(expiration * 1000).toISOString() } : {}),
      type: tagValue(event, "k") === "sell" ? 1 : 0,
      currency,
      currencyCode: currencyCode.toUpperCase(),
      amount: hasRange ? null : toNullableNumber(fiatAmount?.[1]),
      has_range: hasRange,
      is_swap: currency === 1000 || currencyCode.toUpperCase() === "BTC",
      min_amount: toNumber(fiatAmount?.[1]),
      max_amount: toNumber(fiatAmount?.[2]),
      payment_method: tag(event, "pm")?.slice(1).join(" ") ?? "",
      premium: toNumber(tagValue(event, "premium")),
      satoshis: 0,
      maker_nick: name?.[1] ?? "",
      maker_hash_id: makerHashId,
      bond_size_sats: 0,
      ...(bondSizePercent != null ? { bond_size_percent: bondSizePercent } : {}),
      ...(approximateLocation
        ? {
            latitude: approximateLocation[0],
            longitude: approximateLocation[1]
          }
        : {}),
      coordinatorShortAlias: coordinator.shortAlias
    }
  };
}

export function buildNostrRelayUrl(coordinator: Pick<CoordinatorSummary, "url">): string {
  const baseUrl = coordinator.url.trim().replace(/\/$/, "");
  if (!baseUrl) return "";
  if (baseUrl.startsWith("wss://") || baseUrl.startsWith("ws://")) return `${baseUrl}/relay/`;
  if (baseUrl.startsWith("https://")) return `${baseUrl.replace(/^https:\/\//, "wss://")}/relay/`;
  if (baseUrl.startsWith("http://")) return `${baseUrl.replace(/^http:\/\//, "ws://")}/relay/`;
  return "";
}

export function relayFallbackTiming(relay: string): { primaryMs: number; secondaryMs: number } {
  const observedLatency = relayHealthSnapshot(relay)?.latencyMs;
  const primaryMs =
    observedLatency && observedLatency >= 1_000
      ? clamp(Math.round(observedLatency * 1.5), MIN_PRIMARY_SILENCE_MS, MAX_PRIMARY_SILENCE_MS)
      : DEFAULT_PRIMARY_SILENCE_MS;

  return {
    primaryMs,
    secondaryMs: clamp(primaryMs * 2, MIN_SECONDARY_SILENCE_MS, MAX_SECONDARY_SILENCE_MS)
  };
}

export function selectNostrRelays(
  coordinators: Array<Pick<CoordinatorSummary, "url"> & Partial<Pick<CoordinatorSummary, "online">>>,
  hostUrl = "",
  relayCount = DEFAULT_RELAY_COUNT
): string[] {
  const relayAvailability = new Map<string, boolean | undefined>();
  coordinators.forEach((coordinator) => {
    const relay = buildNostrRelayUrl(coordinator);
    if (!relay) return;
    const previous = relayAvailability.get(relay);
    relayAvailability.set(relay, previous === true || coordinator.online === true ? true : coordinator.online);
  });
  const federationRelays = [...relayAvailability.keys()];
  if (federationRelays.length === 0) return [];

  const limit = Math.max(1, Math.min(relayCount, federationRelays.length));
  const relayStateKey = federationRelays
    .map((relay) => `${relay}:${relayAvailability.get(relay) === false ? "offline" : "available"}`)
    .sort()
    .join("|");
  const cacheKey = `${hostUrl}|${limit}|${relayStateKey}`;
  const cached = relaySelectionCache.get(cacheKey);
  if (cached) return [...cached];

  const selected: string[] = [];
  const hostNeedle = normalizeHostForRelayMatch(hostUrl);
  const hostRelay = hostNeedle ? federationRelays.find((relay) => relay.includes(hostNeedle)) : undefined;
  const now = Date.now();
  const relayIsCoolingDown = (relay: string) => (relayFailureUntil.get(relay) ?? 0) > now;

  if (hostRelay && !relayIsCoolingDown(hostRelay) && relayAvailability.get(hostRelay) !== false) {
    selected.push(hostRelay);
  }

  const remaining = federationRelays.filter((relay) => !selected.includes(relay));
  const reportedOnline = remaining.filter(
    (relay) => !relayIsCoolingDown(relay) && relayAvailability.get(relay) === true
  );
  const unknown = remaining.filter((relay) => !relayIsCoolingDown(relay) && relayAvailability.get(relay) === undefined);
  const reportedOffline = remaining.filter(
    (relay) => !relayIsCoolingDown(relay) && relayAvailability.get(relay) === false
  );
  const coolingDown = remaining.filter(relayIsCoolingDown);
  remaining.splice(
    0,
    remaining.length,
    ...orderRelays(reportedOnline),
    ...orderRelays(unknown),
    ...orderRelays(reportedOffline),
    ...orderRelays(coolingDown)
  );
  while (selected.length < limit && remaining.length > 0) {
    const relay = remaining.shift();
    if (!relay) break;
    selected.push(relay);
  }

  relaySelectionCache.set(cacheKey, selected);
  return [...selected];
}

function markRelayUnavailable(relay: string): void {
  relayFailureUntil.set(relay, Date.now() + RELAY_FAILURE_COOLDOWN_MS);
  relaySelectionCache.clear();
}

function markRelayHealthy(relay: string): void {
  if (!relayFailureUntil.delete(relay)) return;
  relaySelectionCache.clear();
}

function normalizeHostForRelayMatch(hostUrl: string): string {
  return hostUrl
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^wss?:\/\//, "")
    .replace(/\/$/, "");
}

function relayMatchesHost(relay: string | undefined, hostUrl = ""): boolean {
  const hostNeedle = normalizeHostForRelayMatch(hostUrl);
  return Boolean(relay && hostNeedle && relay.includes(hostNeedle));
}

function tag(event: Event, key: string): string[] | undefined {
  return event.tags.find((item) => item[0] === key);
}

function tagValue(event: Event, key: string): string | undefined {
  return tag(event, key)?.[1];
}

function parseOrderId(source: string, dTag: string, isRoboSats: boolean): number {
  if (source && isRoboSats) {
    const fromSource = Number(source.split("/").filter(Boolean).at(-1));
    if (Number.isFinite(fromSource) && fromSource > 0) return fromSource;
  }

  const fromDTag = Number(dTag.split(":").filter(Boolean).at(-1));
  return Number.isFinite(fromDTag) && fromDTag > 0 ? fromDTag : 0;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  return toNumber(value);
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = toNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
