import { type Event, type Filter, verifyEvent } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import type { CoordinatorSummary, Network } from "@/domains/coordinators/coordinator.types";
import { currencyIdFromCode } from "@/domains/orderbook/currencies";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { isIOSApp } from "@/domains/transport/androidBridge";

const ORDER_KIND = 38383;
const RELAY_MAX_WAIT_MS = 20000;
const PROGRESS_EMIT_INTERVAL_MS = 350;
const DEFAULT_RELAY_COUNT = 3;
// A healthy onion WebSocket can take several seconds to establish. Avoid
// fanning out across synchronized coordinator relays before that is useful.
const PRIMARY_RELAY_GRACE_MS = 4500;
const FALLBACK_RELAY_GRACE_MS = 8500;
const IOS_PRIMARY_RELAY_GRACE_MS = 1200;
const IOS_FALLBACK_RELAY_GRACE_MS = 2800;
const RECONCILIATION_RELAY_DELAY_MS = 1800;
const SESSION_IDLE_TIMEOUT_MS = 120000;
const RELAY_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

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
const relaySelectionCache = new Map<string, string[]>();
const relayFailureUntil = new Map<string, number>();

export async function fetchNostrOrderbook(
  coordinators: CoordinatorSummary[],
  network: Network,
  options: NostrOrderbookOptions = {}
): Promise<PublicOrder[]> {
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
  private readonly pool = new SimplePool({ enableReconnect: true });
  private readonly filters: Filter[];
  private readonly listeners = new Set<NostrOrderbookListener>();
  private readonly events = new Map<string, Event>();
  private readonly relayEoses = new Map<number, Set<number>>();
  private readonly closedRelays = new Set<number>();
  private readonly subscriptions: Array<ReturnType<SimplePool["subscribeMany"]>> = [];
  private readonly fallbackTimers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly maxWaitMs: number;
  private readonly coordinators: CoordinatorSummary[];
  private readonly network: Network;
  private readonly relays: string[];
  private readonly reconcileAfterInitial: boolean;
  private started = false;
  private initialSettled = false;
  private closed = false;
  private initialPromise?: Promise<PublicOrder[]>;
  private resolveInitial?: (orders: PublicOrder[]) => void;
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
    const since = nowSeconds ?? Math.floor(Date.now() / 1000);
    this.filters = [
      { authors, kinds: [ORDER_KIND], "#s": ["pending"] },
      { authors, kinds: [ORDER_KIND], "#s": ["success", "canceled", "in-progress"], since }
    ];
  }

  start(): Promise<PublicOrder[]> {
    this.cancelIdleClose();
    if (this.initialPromise) return this.initialPromise;

    this.started = true;
    this.initialPromise = new Promise((resolve) => {
      this.resolveInitial = resolve;
    });
    this.startRelay(0);
    this.scheduleFallback(1, isIOSApp() ? IOS_PRIMARY_RELAY_GRACE_MS : PRIMARY_RELAY_GRACE_MS);
    this.scheduleFallback(2, isIOSApp() ? IOS_FALLBACK_RELAY_GRACE_MS : FALLBACK_RELAY_GRACE_MS);
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

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.subscriptions.forEach((subscription) => void subscription.close("complete"));
    this.pool.destroy();
    this.listeners.clear();
    if (sharedSession === this) sharedSession = undefined;
  }

  private startRelay(relayIndex: number): void {
    if (this.closed || relayIndex >= this.relays.length || this.relayEoses.has(relayIndex)) return;
    this.relayEoses.set(relayIndex, new Set());
    const relay = this.relays[relayIndex];
    const subscriptionId = `robosats-orderbook-${Date.now()}-${relayIndex}`;

    this.filters.forEach((filter, filterIndex) => {
      const subscription = this.pool.subscribeMany([relay], filter, {
        id: `${subscriptionId}-${filterIndex}`,
        maxWait: this.maxWaitMs,
        onevent: (event) => this.handleEvent(event),
        oneose: () => this.markEose(relayIndex, filterIndex),
        onclose: () => this.handleRelayClose(relayIndex, relay)
      });
      this.subscriptions.push(subscription);
    });
  }

  private scheduleFallback(relayIndex: number, delayMs: number): void {
    if (relayIndex >= this.relays.length) return;
    const timer = setTimeout(() => this.startRelay(relayIndex), delayMs);
    this.fallbackTimers.push(timer);
  }

  private handleEvent(event: Event): void {
    if (this.closed || !verifyEvent(event)) return;
    this.events.set(event.id, event);
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined;
      const orders = this.currentOrders();
      this.emit(!this.initialSettled, this.initialSettled, orders);
    }, PROGRESS_EMIT_INTERVAL_MS);
  }

  private markEose(relayIndex: number, filterIndex: number): void {
    if (this.closed || this.initialSettled) return;
    const completedFilters = this.relayEoses.get(relayIndex);
    if (!completedFilters) return;
    completedFilters.add(filterIndex);
    if (completedFilters.size !== this.filters.length) return;
    markRelayHealthy(this.relays[relayIndex]);

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

  private handleRelayClose(relayIndex: number, relay: string): void {
    if (this.closed || this.closedRelays.has(relayIndex)) return;
    this.closedRelays.add(relayIndex);
    markRelayUnavailable(relay);

    // EOSE completes the initial snapshot but the subscription remains the
    // live update channel. Replace it even when the initial fetch has settled.
    const nextRelay = this.relays.findIndex((_candidate, index) => index > relayIndex && !this.relayEoses.has(index));
    if (nextRelay >= 0) this.startRelay(nextRelay);
  }

  private finishInitial(orders = this.currentOrders(), authoritative = true): void {
    if (this.closed || this.initialSettled) return;
    this.initialSettled = true;
    if (this.finalTimer) clearTimeout(this.finalTimer);
    this.fallbackTimers.forEach((timer) => clearTimeout(timer));
    this.fallbackTimers.length = 0;
    if (authoritative && orders.length > 0 && this.reconcileAfterInitial) {
      const reconciliationRelay = this.relays.findIndex((_relay, index) => !this.relayEoses.has(index));
      if (reconciliationRelay >= 0) {
        this.scheduleFallback(reconciliationRelay, RECONCILIATION_RELAY_DELAY_MS);
      }
    }
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = undefined;
    }
    this.emit(!authoritative, authoritative, orders);
    this.resolveInitial?.(orders);
    this.resolveInitial = undefined;
    if (this.listeners.size === 0) this.scheduleIdleClose();
  }

  private currentOrders(): PublicOrder[] {
    return nostrEventsToPublicOrders([...this.events.values()], this.coordinators, this.network);
  }

  private emit(partial: boolean, authoritative: boolean, orders = this.currentOrders()): void {
    this.listeners.forEach((listener) => listener(orders, { partial, authoritative }));
  }

  private completedRelayCount(): number {
    return [...this.relayEoses.values()]
      .filter((filters) => filters.size === this.filters.length).length;
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
  const unknown = remaining.filter(
    (relay) => !relayIsCoolingDown(relay) && relayAvailability.get(relay) === undefined
  );
  const reportedOffline = remaining.filter(
    (relay) => !relayIsCoolingDown(relay) && relayAvailability.get(relay) === false
  );
  const coolingDown = remaining.filter(relayIsCoolingDown);
  shuffleInPlace(reportedOnline);
  shuffleInPlace(coolingDown);
  remaining.splice(0, remaining.length, ...reportedOnline, ...unknown, ...reportedOffline, ...coolingDown);
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

function shuffleInPlace<T>(values: T[]): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
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
