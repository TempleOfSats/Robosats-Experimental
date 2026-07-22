import { finalizeEvent, getPublicKey, verifyEvent, type Event } from "nostr-tools/pure";
import type { SimplePool, SubCloser } from "nostr-tools/pool";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { getSharedRelayPool, runRelayQuery } from "@/domains/nostr/sharedRelayPool";
import { buildNostrRelayUrl } from "@/domains/orderbook/nostrOrderbook";
import { systemClient } from "@/domains/transport/systemClient";
import { decryptGaragePayload, deriveGarageDomainKey, encryptGaragePayload, type GarageKeyDomain } from "@/domains/pro/garageCrypto";
import {
  getGarageSecret,
  recoverySnapshotFromRecords,
  useGarageVaultStore,
  type GarageRecoverySnapshot
} from "@/domains/pro/garageVaultStore";
import {
  GARAGE_SYNC_LIMITS,
  compareSyncRecords,
  syncRecordAddress,
  syncRecordDomain,
  syncRecordKey,
  validateGarageSyncRecord,
  type GarageObservedEvent,
  type GarageOutboxItem,
  type GarageSyncRecord,
  type ObservedGarageSyncRecord
} from "@/domains/pro/garageSyncRecords";

const APPLICATION_DATA_KIND = 30078;
const BOOTSTRAP_TIMEOUT_MS = 8_000;
const ROUTINE_RELAY_TIMEOUT_MS = BOOTSTRAP_TIMEOUT_MS;
const CURSOR_OVERLAP_SECONDS = 120;
const FULL_PULL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FALLBACK_PULL_MIN_MS = 30_000;
const FALLBACK_PULL_JITTER_MS = 30_000;
const HEARTBEAT_MS = 14 * 24 * 60 * 60 * 1000;
const MUTATION_DEBOUNCE_MS = 250;
const retryDelays = [5_000, 15_000, 45_000, 120_000, 300_000] as const;
const encoder = new TextEncoder();
const CURSOR_STORAGE_KEY = "robosats_exp_garage_sync_cursors_v3";

type SyncDomain = Extract<GarageKeyDomain, "garage-sync" | "settings-sync">;

type RelayHealth = {
  failures: number;
  latencyMs: number;
  lastSuccessAt: number;
};

type PullCursor = {
  since: number;
  lastFullAt: number;
};

type RelayPullResult = {
  relay: string;
  records: ObservedGarageSyncRecord[];
};

type GarageSyncOptions = {
  forcePublish?: boolean;
};

export class GarageSyncEngine {
  private readonly pool = getSharedRelayPool();
  private coordinators: () => CoordinatorSummary[] = () => [];
  private subscription?: SubCloser;
  private relayKey = "";
  private stopped = true;
  private syncInFlight?: Promise<number>;
  private syncRequested = false;
  private forceRequested = false;
  private mutationTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private retryIndex = 0;
  private generation = 0;
  private relayHealth = new Map<string, RelayHealth>();

  start(coordinators: () => CoordinatorSummary[], synchronize = true): void {
    const shouldSynchronize = this.stopped && synchronize;
    this.coordinators = coordinators;
    this.stopped = false;
    this.ensureSubscription();
    this.scheduleFallbackPull();
    if (shouldSynchronize) void this.synchronize().catch(() => undefined);
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.subscription?.close("stopped");
    this.subscription = undefined;
    this.relayKey = "";
    if (this.mutationTimer) clearTimeout(this.mutationTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.mutationTimer = undefined;
    this.retryTimer = undefined;
    this.fallbackTimer = undefined;
  }

  reconfigure(): void {
    if (this.stopped) return;
    this.ensureSubscription();
    void this.synchronize().catch(() => undefined);
  }

  resume(): void {
    if (this.stopped || !isForeground()) return;
    this.ensureSubscription();
    this.scheduleFallbackPull();
    void this.synchronize().catch(() => undefined);
  }

  pause(): void {
    this.subscription?.close("paused");
    this.subscription = undefined;
    this.relayKey = "";
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = undefined;
  }

  notifyMutation(): void {
    if (this.stopped || !isForeground()) return;
    if (this.mutationTimer) clearTimeout(this.mutationTimer);
    const delay = MUTATION_DEBOUNCE_MS + Math.floor(Math.random() * 501);
    this.mutationTimer = setTimeout(() => {
      this.mutationTimer = undefined;
      void this.synchronize().catch(() => undefined);
    }, delay);
  }

  async synchronize(options: GarageSyncOptions = {}): Promise<number> {
    this.syncRequested = true;
    this.forceRequested ||= options.forcePublish === true;
    if (this.syncInFlight) return this.syncInFlight;
    this.syncInFlight = this.runSynchronization().finally(() => { this.syncInFlight = undefined; });
    return this.syncInFlight;
  }

  private async runSynchronization(): Promise<number> {
    let lastPublicationAt = 0;
    useGarageVaultStore.getState().setSyncState("saving");
    try {
      do {
        this.syncRequested = false;
        const force = this.forceRequested;
        this.forceRequested = false;
        if (force || heartbeatDue()) useGarageVaultStore.getState().queueHeartbeat();
        const secret = getGarageSecret();
        const relays = this.orderedRelays();
        if (!secret || relays.length === 0) throw new Error("No coordinator relay is available.");
        const resumeSubscription = this.suspendSubscription();
        try {
          await this.pullRoutineRecords(secret, relays, force);
          lastPublicationAt = await this.flushOutbox(secret, relays);
        } finally {
          resumeSubscription();
        }
      } while (this.syncRequested);
      this.retryIndex = 0;
      useGarageVaultStore.getState().setSyncState("up-to-date", Date.now(), undefined, lastPublicationAt || undefined);
      return lastPublicationAt;
    } catch (error) {
      this.scheduleRetry();
      useGarageVaultStore.getState().setSyncState(
        "offline",
        undefined,
        error instanceof Error ? error.message : "Fleet changes will sync when the connection returns."
      );
      throw error;
    }
  }

  private async flushOutbox(secret: Uint8Array, relays: string[]): Promise<number> {
    let latestPublishedAt = 0;
    let publicationFailed = false;
    while (true) {
      const now = Date.now();
      const batch = useGarageVaultStore.getState().pendingOutbox()
        .filter(({ item }) => item.nextAttemptAt <= now)
        .sort((left, right) => recordPriority(left.record) - recordPriority(right.record)
          || left.item.queuedAt - right.item.queuedAt)
        .slice(0, GARAGE_SYNC_LIMITS.publishBatch);
      if (batch.length === 0) break;
      const outcomes = await Promise.all(batch.map(async ({ item, record }) => {
        const requiredAcknowledgements = Math.min(2, relays.length);
        const existingAcknowledgements = item.acceptedRelays.filter((relay) => relays.includes(relay));
        if (existingAcknowledgements.length >= requiredAcknowledgements
          && item.acceptedEventId && item.acceptedPublishedAt !== undefined) {
          useGarageVaultStore.getState().acknowledgeOutbox(item.key, record.revision, {
            eventId: item.acceptedEventId,
            publishedAt: item.acceptedPublishedAt,
            revision: record.revision,
            writerDeviceId: record.writerDeviceId
          });
          latestPublishedAt = Math.max(latestPublishedAt, item.acceptedPublishedAt);
          return true;
        }
        const observed = useGarageVaultStore.getState().envelope?.observed[item.key];
        const createdAt = Math.max(
          Math.floor(Date.now() / 1000),
          observed ? Math.floor(observed.publishedAt / 1000) + 1 : 0
        );
        const event = buildGarageRecordEvent(secret, record, createdAt);
        const eventObservation = {
          eventId: event.id,
          publishedAt: createdAt * 1000,
          revision: record.revision,
          writerDeviceId: record.writerDeviceId
        };
        const publication = await this.publishWithReplication(relays, item, event, eventObservation);
        if (publication.accepted) {
          latestPublishedAt = Math.max(latestPublishedAt, publication.publishedAt);
          return true;
        }
        publicationFailed = true;
        return false;
      }));
      if (batch.length < GARAGE_SYNC_LIMITS.publishBatch) break;
      if (!outcomes.some(Boolean)) break;
      await wait(100 + Math.floor(Math.random() * 201));
    }
    if (publicationFailed) throw new Error("Coordinator relays did not accept all Fleet changes.");
    return latestPublishedAt;
  }

  private ensureSubscription(): void {
    const secret = getGarageSecret();
    const relays = this.orderedRelays();
    if (this.stopped || !secret || relays.length === 0 || !isForeground()) return;
    const key = relays.slice().sort().join("|");
    if (this.subscription && key === this.relayKey) return;
    this.subscription?.close("reconfigured");
    this.relayKey = key;
    const authors = syncAuthors(secret);
    this.subscription = this.pool.subscribeMany(relays, {
      authors,
      kinds: [APPLICATION_DATA_KIND],
      since: Math.floor(Date.now() / 1000) - 30
    }, {
      onevent: (event) => {
        const observed = decodeGarageRecordEvent(event, secret);
        if (!observed) return;
        useGarageVaultStore.getState().applyRemoteRecords([observed]);
      }
    });
  }

  private suspendSubscription(): () => void {
    const shouldResume = !this.stopped && isForeground();
    this.subscription?.close("synchronizing");
    this.subscription = undefined;
    this.relayKey = "";
    return () => {
      if (shouldResume) this.ensureSubscription();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer || !isForeground()) return;
    const delay = retryDelays[Math.min(this.retryIndex, retryDelays.length - 1)];
    this.retryIndex += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.synchronize().catch(() => undefined);
    }, delay);
  }

  private scheduleFallbackPull(): void {
    if (this.stopped || !isForeground()) return;
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    const delay = FALLBACK_PULL_MIN_MS + Math.floor(Math.random() * (FALLBACK_PULL_JITTER_MS + 1));
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = undefined;
      void this.synchronize().catch(() => undefined);
      this.scheduleFallbackPull();
    }, delay);
  }

  private relays(): string[] {
    return garageRelayUrls(this.coordinators());
  }

  private orderedRelays(): string[] {
    return this.relays().sort((left, right) => compareRelayHealth(this.relayHealth.get(left), this.relayHealth.get(right)));
  }

  private async pullRoutineRecords(secret: Uint8Array, relays: string[], waitForAll: boolean): Promise<void> {
    const generation = this.generation;
    const identity = syncIdentity(secret);
    const pulls = relays.map((relay) => this.pullRelay(secret, identity, relay));
    if (waitForAll) {
      const results = await Promise.allSettled(pulls);
      const successful = results.flatMap((result) => result.status === "fulfilled" ? result.value.records : []);
      if (!results.some((result) => result.status === "fulfilled")) throw new Error("No coordinator relay is available.");
      useGarageVaultStore.getState().applyRemoteRecords(mergeObservedRecords(successful));
      return;
    }
    const first = await Promise.any(pulls);
    useGarageVaultStore.getState().applyRemoteRecords(first.records);

    void Promise.allSettled(pulls).then((results) => {
      if (this.stopped || generation !== this.generation || syncIdentity(getGarageSecret()) !== identity) return;
      const records = mergeObservedRecords(results.flatMap((result) => result.status === "fulfilled" ? result.value.records : []));
      useGarageVaultStore.getState().applyRemoteRecords(records);
    });
  }

  private async pullRelay(secret: Uint8Array, identity: string, relay: string): Promise<RelayPullResult> {
    const startedAt = Date.now();
    try {
      const records = await queryRelayRecords(this.pool, secret, identity, relay, ROUTINE_RELAY_TIMEOUT_MS);
      this.noteRelaySuccess(relay, Date.now() - startedAt);
      return { relay, records };
    } catch (error) {
      this.noteRelayFailure(relay);
      throw error;
    }
  }

  private async publishWithReplication(
    relays: string[],
    item: GarageOutboxItem,
    event: Event,
    observed: GarageObservedEvent
  ): Promise<{ accepted: boolean; publishedAt: number }> {
    const accepted = new Set(item.acceptedRelays.filter((relay) => relays.includes(relay)));
    const required = Math.min(2, relays.length);
    if (accepted.size >= required) {
      return { accepted: true, publishedAt: item.acceptedPublishedAt ?? observed.publishedAt };
    }
    const targets = relays.filter((relay) => !accepted.has(relay));
    if (targets.length === 0) {
      this.deferReplication(item);
      return { accepted: accepted.size > 0, publishedAt: item.acceptedPublishedAt ?? 0 };
    }

    let resolveFirst: (accepted: boolean) => void = () => undefined;
    const firstAcknowledgement = new Promise<boolean>((resolve) => { resolveFirst = resolve; });
    let firstSettled = accepted.size > 0;
    let latestPublishedAt = item.acceptedPublishedAt ?? 0;
    let replicationDeferred = false;
    const defer = () => {
      if (replicationDeferred) return;
      replicationDeferred = true;
      this.deferReplication(item);
    };
    if (firstSettled) resolveFirst(true);
    void new Promise<void>((resolveAll) => {
      let settled = 0;
      const finish = () => {
        if (settled < targets.length) return;
        if (!firstSettled) {
          firstSettled = true;
          resolveFirst(false);
        }
        if (accepted.size < required) defer();
        resolveAll();
      };
      targets.forEach((relay) => {
        const startedAt = Date.now();
        const [published] = this.pool.publish([relay], event, { maxWait: ROUTINE_RELAY_TIMEOUT_MS });
        void published.then(() => {
          accepted.add(relay);
          latestPublishedAt = Math.max(latestPublishedAt, observed.publishedAt);
          useGarageVaultStore.getState().recordOutboxAcknowledgements(item.key, item.revision, [relay], observed);
          this.noteRelaySuccess(relay, Date.now() - startedAt);
          if (!firstSettled) {
            firstSettled = true;
            resolveFirst(true);
          }
          if (accepted.size >= required) {
            useGarageVaultStore.getState().acknowledgeOutbox(item.key, item.revision, observed);
          }
        }, () => {
          this.noteRelayFailure(relay);
        }).finally(() => {
          settled += 1;
          finish();
        });
      });
      finish();
    });
    const locallyAccepted = await firstAcknowledgement;
    if (locallyAccepted && accepted.size < required) defer();
    return {
      accepted: locallyAccepted,
      publishedAt: latestPublishedAt
    };
  }

  private deferReplication(item: GarageOutboxItem): void {
    const delay = retryDelays[Math.min(item.attempts, retryDelays.length - 1)];
    useGarageVaultStore.getState().deferOutbox(item.key, item.revision, Date.now() + delay);
    this.scheduleRetry();
  }

  private noteRelaySuccess(relay: string, latencyMs: number): void {
    const previous = this.relayHealth.get(relay);
    this.relayHealth.set(relay, {
      failures: Math.max(0, (previous?.failures ?? 0) - 1),
      latencyMs: previous ? Math.round(previous.latencyMs * 0.7 + latencyMs * 0.3) : latencyMs,
      lastSuccessAt: Date.now()
    });
  }

  private noteRelayFailure(relay: string): void {
    const previous = this.relayHealth.get(relay);
    this.relayHealth.set(relay, {
      failures: Math.min(10, (previous?.failures ?? 0) + 1),
      latencyMs: previous?.latencyMs ?? ROUTINE_RELAY_TIMEOUT_MS,
      lastSuccessAt: previous?.lastSuccessAt ?? 0
    });
  }
}

export const garageSyncEngine = new GarageSyncEngine();

export function garageRelayUrls(coordinators: CoordinatorSummary[]): string[] {
  return [...new Set(coordinators
    .filter((coordinator) => coordinator.enabled && coordinator.shortAlias !== "local")
    .map(buildNostrRelayUrl)
    .filter(Boolean))];
}

export function buildGarageRecordEvent(
  secret: Uint8Array,
  record: GarageSyncRecord,
  createdAt = Math.floor(Date.now() / 1000)
): Event {
  validateGarageSyncRecord(record);
  const domain = syncRecordDomain(record);
  const key = deriveGarageDomainKey(secret, domain);
  const event = finalizeEvent({
    kind: APPLICATION_DATA_KIND,
    created_at: createdAt,
    tags: [["d", syncRecordAddress(secret, record)]],
    content: encryptGaragePayload(secret, domain, JSON.stringify(record))
  }, key);
  if (encoder.encode(JSON.stringify(event)).length > GARAGE_SYNC_LIMITS.eventBytes) throw new Error("Garage record is too large.");
  return event;
}

export function decodeGarageRecordEvent(event: Event, secret: Uint8Array): ObservedGarageSyncRecord | undefined {
  if (event.kind !== APPLICATION_DATA_KIND || !verifyEvent(event)) return undefined;
  if (encoder.encode(JSON.stringify(event)).length > GARAGE_SYNC_LIMITS.eventBytes) return undefined;
  const domain = eventDomain(event, secret);
  if (!domain) return undefined;
  try {
    const record = JSON.parse(decryptGaragePayload(secret, domain, event.content)) as unknown;
    validateGarageSyncRecord(record);
    if (syncRecordDomain(record) !== domain) return undefined;
    const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
    if (dTag !== syncRecordAddress(secret, record)) return undefined;
    return { record, eventId: event.id, publishedAt: event.created_at * 1000 };
  } catch {
    return undefined;
  }
}

export async function queryGarageRecords(
  pool: SimplePool,
  secret: Uint8Array,
  relays: string[],
  maxWait = BOOTSTRAP_TIMEOUT_MS
): Promise<ObservedGarageSyncRecord[]> {
  const queries = relays.flatMap((relay) => syncAuthors(secret).map((author) =>
    queryAuthorRecords(pool, relay, author, maxWait)));
  const results = await Promise.allSettled(queries);
  if (!results.some((result) => result.status === "fulfilled")) {
    throw new Error("No coordinator relay is available.");
  }
  const events = results.flatMap((result) => result.status === "fulfilled" ? result.value.events : []);
  return decodeLatestRecords(events, secret);
}

async function queryRelayRecords(
  pool: SimplePool,
  secret: Uint8Array,
  identity: string,
  relay: string,
  maxWait: number
): Promise<ObservedGarageSyncRecord[]> {
  const queryStartedAt = Math.floor(Date.now() / 1000);
  const events: Event[] = [];
  for (const { domain, author } of syncDomainAuthors(secret)) {
    const cursor = readPullCursor(identity, relay, domain);
    const full = !cursor || Date.now() - cursor.lastFullAt >= FULL_PULL_INTERVAL_MS;
    const since = full ? undefined : Math.max(0, cursor.since - CURSOR_OVERLAP_SECONDS);
    const result = await queryAuthorRecords(pool, relay, author, maxWait, since);
    events.push(...result.events);
    if (result.complete) {
      writePullCursor(identity, relay, domain, {
        since: queryStartedAt,
        lastFullAt: full ? Date.now() : cursor.lastFullAt
      });
    }
  }
  return decodeLatestRecords(events, secret);
}

type PagedEventQuery = {
  events: Event[];
  complete: boolean;
};

async function queryAuthorRecords(
  pool: SimplePool,
  relay: string,
  author: string,
  maxWait: number,
  since?: number
): Promise<PagedEventQuery> {
  const deadline = Date.now() + maxWait;
  const events = new Map<string, Event>();
  let until: number | undefined;
  while (events.size < GARAGE_SYNC_LIMITS.queryRecords && Date.now() < deadline) {
    const remainingWait = Math.max(1, deadline - Date.now());
    const page = await runRelayQuery(relay, () => pool.querySync([relay], {
      authors: [author],
      kinds: [APPLICATION_DATA_KIND],
      limit: GARAGE_SYNC_LIMITS.queryPageRecords,
      ...(since === undefined ? {} : { since }),
      ...(until === undefined ? {} : { until })
    }, { maxWait: remainingWait }));
    const previousSize = events.size;
    page.forEach((event) => events.set(event.id, event));
    if (page.length < GARAGE_SYNC_LIMITS.queryPageRecords) {
      return { events: [...events.values()], complete: true };
    }
    const oldest = Math.min(...page.map((event) => event.created_at));
    const nextUntil = oldest - 1;
    if (events.size === previousSize || (since !== undefined && nextUntil < since)) {
      return { events: [...events.values()], complete: true };
    }
    until = nextUntil;
  }
  return { events: [...events.values()].slice(0, GARAGE_SYNC_LIMITS.queryRecords), complete: false };
}

function decodeLatestRecords(events: Event[], secret: Uint8Array): ObservedGarageSyncRecord[] {
  const latest = new Map<string, ObservedGarageSyncRecord>();
  for (const event of events) {
    const observed = decodeGarageRecordEvent(event, secret);
    if (!observed) continue;
    const key = syncRecordKey(observed.record);
    const current = latest.get(key);
    if (!current || compareSyncRecords(observed.record, current.record, observed.eventId, current.eventId) > 0) {
      latest.set(key, { ...observed, publishedAt: Math.max(observed.publishedAt, current?.publishedAt ?? 0) });
    } else if (observed.publishedAt > current.publishedAt) {
      latest.set(key, { ...current, publishedAt: observed.publishedAt });
    }
  }
  return [...latest.values()];
}

function mergeObservedRecords(records: ObservedGarageSyncRecord[]): ObservedGarageSyncRecord[] {
  const latest = new Map<string, ObservedGarageSyncRecord>();
  for (const observed of records) {
    const key = syncRecordKey(observed.record);
    const current = latest.get(key);
    if (!current || compareSyncRecords(observed.record, current.record, observed.eventId, current.eventId) > 0) {
      latest.set(key, { ...observed, publishedAt: Math.max(observed.publishedAt, current?.publishedAt ?? 0) });
    } else if (observed.publishedAt > current.publishedAt) {
      latest.set(key, { ...current, publishedAt: observed.publishedAt });
    }
  }
  return [...latest.values()];
}

export async function recoverGarageSnapshot(
  secret: Uint8Array,
  coordinators: CoordinatorSummary[]
): Promise<GarageRecoverySnapshot> {
  const relays = garageRelayUrls(coordinators);
  if (relays.length === 0) throw new Error("No coordinator is available. Check your connection and try again.");
  const records = await queryGarageRecords(getSharedRelayPool(), secret, relays, BOOTSTRAP_TIMEOUT_MS);
  if (records.length === 0) {
    throw new Error("No Fleet was found for this key. Check the key and connection, then try again.");
  }
  return recoverySnapshotFromRecords(secret, records);
}

export function stopGarageSyncSchedule(): void {
  garageSyncEngine.stop();
}

function syncAuthors(secret: Uint8Array): string[] {
  return syncDomainAuthors(secret).map(({ author }) => author);
}

function syncDomainAuthors(secret: Uint8Array): Array<{ domain: SyncDomain; author: string }> {
  return (["garage-sync", "settings-sync"] as const).map((domain) => ({
    domain,
    author: getPublicKey(deriveGarageDomainKey(secret, domain))
  }));
}

function eventDomain(event: Event, secret: Uint8Array): GarageKeyDomain | undefined {
  if (event.pubkey === getPublicKey(deriveGarageDomainKey(secret, "garage-sync"))) return "garage-sync";
  if (event.pubkey === getPublicKey(deriveGarageDomainKey(secret, "settings-sync"))) return "settings-sync";
  return undefined;
}

function heartbeatDue(now = Date.now()): boolean {
  const envelope = useGarageVaultStore.getState().envelope;
  if (!envelope) return false;
  const observed = Object.values(envelope.observed);
  return observed.length === 0 || now - Math.min(...observed.map((item) => item.publishedAt)) >= HEARTBEAT_MS;
}

function isForeground(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function syncIdentity(secret: Uint8Array | undefined): string {
  return secret ? syncAuthors(secret).join(":") : "";
}

function compareRelayHealth(left: RelayHealth | undefined, right: RelayHealth | undefined): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.failures - right.failures
    || left.latencyMs - right.latencyMs
    || right.lastSuccessAt - left.lastSuccessAt;
}

function recordPriority(record: GarageSyncRecord): number {
  if (record.type === "robot-tombstone") return 0;
  if (record.type === "robot") return 1;
  if (record.type === "preset-tombstone") return 2;
  if (record.type === "preset") return 3;
  return 4;
}

type CursorStore = {
  version: 1;
  identities: Record<string, Record<string, Partial<Record<SyncDomain, PullCursor>>>>;
};

function readPullCursor(identity: string, relay: string, domain: SyncDomain): PullCursor | undefined {
  return readCursorStore().identities[identity]?.[relay]?.[domain];
}

function writePullCursor(identity: string, relay: string, domain: SyncDomain, cursor: PullCursor): void {
  const store = readCursorStore();
  store.identities[identity] ??= {};
  store.identities[identity][relay] ??= {};
  store.identities[identity][relay][domain] = cursor;
  try {
    systemClient.setItem(CURSOR_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Incremental cursors are an optimization; synchronization remains correct without persistence.
  }
}

function readCursorStore(): CursorStore {
  try {
    const raw = systemClient.getItem(CURSOR_STORAGE_KEY);
    if (!raw) return emptyCursorStore();
    const parsed = JSON.parse(raw) as unknown;
    if (!isCursorStore(parsed)) return emptyCursorStore();
    return parsed;
  } catch {
    return emptyCursorStore();
  }
}

function emptyCursorStore(): CursorStore {
  return { version: 1, identities: {} };
}

function isCursorStore(value: unknown): value is CursorStore {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { version?: unknown; identities?: unknown };
  if (candidate.version !== 1 || !candidate.identities || typeof candidate.identities !== "object") return false;
  for (const relays of Object.values(candidate.identities as Record<string, unknown>)) {
    if (!relays || typeof relays !== "object") return false;
    for (const domains of Object.values(relays as Record<string, unknown>)) {
      if (!domains || typeof domains !== "object") return false;
      for (const cursor of Object.values(domains as Record<string, unknown>)) {
        if (!cursor || typeof cursor !== "object") return false;
        const entry = cursor as { since?: unknown; lastFullAt?: unknown };
        if (!Number.isSafeInteger(entry.since) || (entry.since as number) < 0
          || !Number.isSafeInteger(entry.lastFullAt) || (entry.lastFullAt as number) < 0) return false;
      }
    }
  }
  return true;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
