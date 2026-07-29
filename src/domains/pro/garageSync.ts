import { finalizeEvent, getPublicKey, verifyEvent, type Event } from "nostr-tools/pure";
import type { SimplePool, SubCloser } from "nostr-tools/pool";
import { normalizeURL } from "nostr-tools/utils";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { recordRelayPerformance } from "@/domains/diagnostics/networkPerformance";
import {
  getLiveRelaySubscriptions,
  getSharedRelayPool,
  runRelayQuery,
  withRelayQueryPool
} from "@/domains/nostr/sharedRelayPool";
import {
  isRelayLiveHealthy,
  noteRelayConnected,
  noteRelayDisconnected,
  noteRelayEose,
  noteRelayEvent,
  noteRelayFailure,
  noteRelaySuccess,
  orderRelays
} from "@/domains/nostr/relayHealth";
import { relayRetryDelay } from "@/domains/nostr/relayRetry";
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
const RECOVERY_RELAY_TIMEOUT_MS = 20_000;
const RECOVERY_EMPTY_RETRY_DELAYS_MS = [1_500, 3_000] as const;
const ROUTINE_RELAY_TIMEOUT_MS = BOOTSTRAP_TIMEOUT_MS;
const ROUTINE_PRIMARY_RELAY_COUNT = 2;
const ROUTINE_SECONDARY_DELAY_MS = 15_000;
const CURSOR_OVERLAP_SECONDS = 120;
const FULL_PULL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FALLBACK_PULL_MIN_MS = 30_000;
const FALLBACK_PULL_JITTER_MS = 30_000;
const HEALTHY_FALLBACK_PULL_MIN_MS = 3 * 60_000;
const HEALTHY_FALLBACK_PULL_JITTER_MS = 2 * 60_000;
const HEARTBEAT_MS = 14 * 24 * 60 * 60 * 1000;
const MUTATION_DEBOUNCE_MS = 250;
const RESUME_SYNC_COOLDOWN_MS = 15_000;
const retryDelays = [5_000, 15_000, 45_000, 120_000, 300_000] as const;
const encoder = new TextEncoder();
const CURSOR_STORAGE_KEY = "robosats_exp_garage_sync_cursors_v3";

type SyncDomain = Extract<GarageKeyDomain, "garage-sync" | "settings-sync" | "history-sync">;

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

export type GarageRelayQueryProgress = {
  pending: number;
  reachable: number;
  total: number;
  unavailable: number;
};

export type GarageRecordQueryResult = {
  records: ObservedGarageSyncRecord[];
  reachableRelays: string[];
  unavailableRelays: string[];
};

export type GarageRecoveryOptions = {
  onFirstSnapshot?: (snapshot: GarageRecoverySnapshot) => void | Promise<void>;
  onProgress?: (progress: GarageRelayQueryProgress) => void;
  onRecordsComplete?: (
    records: ObservedGarageSyncRecord[],
    result: GarageRecordQueryResult
  ) => void | Promise<void>;
};

export class GarageSyncEngine {
  private readonly pool = getSharedRelayPool();
  private readonly liveSubscriptions = getLiveRelaySubscriptions();
  private coordinators: () => CoordinatorSummary[] = () => [];
  private readonly subscriptions = new Map<string, SubCloser>();
  private relayKey = "";
  private stopped = true;
  private syncInFlight?: Promise<number>;
  private syncRequested = false;
  private forceRequested = false;
  private mutationTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private readonly subscriptionRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subscriptionRetryAttempts = new Map<string, number>();
  private retryIndex = 0;
  private generation = 0;
  private lastSynchronizationStartedAt = 0;
  private readonly liveRelaysWithEvents = new Set<string>();

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
    this.closeSubscriptions("stopped");
    this.relayKey = "";
    this.clearSubscriptionRetryTimers();
    if (this.mutationTimer) clearTimeout(this.mutationTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.mutationTimer = undefined;
    this.retryTimer = undefined;
    this.fallbackTimer = undefined;
  }

  reconfigure(): void {
    if (this.stopped) return;
    const previousRelayKey = this.relayKey;
    this.ensureSubscription();
    if (this.relayKey === previousRelayKey) return;
    void this.synchronize().catch(() => undefined);
  }

  resume(): void {
    if (this.stopped || !isForeground()) return;
    const hadSubscriptions = this.subscriptions.size > 0;
    this.ensureSubscription();
    this.scheduleFallbackPull();
    if (this.syncInFlight) return;
    const reopenedSubscriptions = !hadSubscriptions && this.subscriptions.size > 0;
    if (!reopenedSubscriptions && Date.now() - this.lastSynchronizationStartedAt < RESUME_SYNC_COOLDOWN_MS) return;
    void this.synchronize().catch(() => undefined);
  }

  pause(): void {
    this.closeSubscriptions("paused");
    this.relayKey = "";
    this.clearSubscriptionRetryTimers();
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
    this.lastSynchronizationStartedAt = Date.now();
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
        await this.pullRoutineRecords(secret, relays, force);
        this.ensureSubscription();
        lastPublicationAt = await this.flushOutbox(secret, relays);
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
    const relays = this.orderedRelays().slice(0, ROUTINE_PRIMARY_RELAY_COUNT);
    if (this.stopped || !secret || relays.length === 0 || !isForeground()) return;
    const key = relays.slice().sort().join("|");
    const desiredRelays = new Set(relays);
    for (const [relay, subscription] of this.subscriptions) {
      if (desiredRelays.has(relay)) continue;
      this.subscriptions.delete(relay);
      subscription.close("reconfigured");
      this.clearSubscriptionRetry(relay);
    }
    for (const relay of this.subscriptionRetryTimers.keys()) {
      if (!desiredRelays.has(relay)) this.clearSubscriptionRetry(relay);
    }
    this.relayKey = key;
    relays.forEach((relay) => {
      if (!this.subscriptions.has(relay) && !this.subscriptionRetryTimers.has(relay)) {
        this.subscribeRelay(relay, secret);
      }
    });
  }

  private subscribeRelay(relay: string, secret: Uint8Array): void {
    const startedAt = Date.now();
    noteRelayConnected(relay);
    recordRelayPerformance(relay, "connect", 0);
    let subscription: SubCloser;
    subscription = this.liveSubscriptions.subscribeMany([relay], {
      authors: syncAuthors(secret),
      kinds: [APPLICATION_DATA_KIND],
      since: Math.floor(Date.now() / 1000) - 30
    }, {
      onevent: (event) => {
        this.subscriptionRetryAttempts.delete(relay);
        noteRelayEvent(relay);
        if (!this.liveRelaysWithEvents.has(relay)) {
          this.liveRelaysWithEvents.add(relay);
          recordRelayPerformance(relay, "first-event", Date.now() - startedAt);
        }
        const observed = decodeGarageRecordEvent(event, secret);
        if (!observed) return;
        useGarageVaultStore.getState().applyRemoteRecords([observed]);
      },
      oneose: () => {
        this.subscriptionRetryAttempts.delete(relay);
        noteRelayEose(relay, Date.now() - startedAt);
        recordRelayPerformance(relay, "eose", Date.now() - startedAt);
      },
      onclose: () => {
        if (this.subscriptions.get(relay) !== subscription) return;
        this.subscriptions.delete(relay);
        noteRelayDisconnected(relay);
        this.liveRelaysWithEvents.delete(relay);
        recordRelayPerformance(relay, "close", Date.now() - startedAt, "network-error");
        if (!this.stopped && isForeground()) {
          this.scheduleSubscriptionReconnect(relay);
          this.scheduleFallbackPull();
        }
      }
    });
    this.subscriptions.set(relay, subscription);
  }

  private scheduleSubscriptionReconnect(relay: string): void {
    if (this.subscriptionRetryTimers.has(relay)) return;
    const attempt = this.subscriptionRetryAttempts.get(relay) ?? 0;
    this.subscriptionRetryAttempts.set(relay, attempt + 1);
    const timer = setTimeout(() => {
      this.subscriptionRetryTimers.delete(relay);
      if (this.stopped || !isForeground() || !this.relays().includes(relay)) return;
      this.ensureSubscription();
    }, relayRetryDelay(attempt));
    this.subscriptionRetryTimers.set(relay, timer);
  }

  private closeSubscriptions(reason: string): void {
    const subscriptions = [...this.subscriptions.values()];
    this.subscriptions.clear();
    this.liveRelaysWithEvents.clear();
    subscriptions.forEach((subscription) => subscription.close(reason));
  }

  private clearSubscriptionRetry(relay: string): void {
    const timer = this.subscriptionRetryTimers.get(relay);
    if (timer) clearTimeout(timer);
    this.subscriptionRetryTimers.delete(relay);
    this.subscriptionRetryAttempts.delete(relay);
  }

  private clearSubscriptionRetryTimers(): void {
    [...this.subscriptionRetryTimers.keys()].forEach((relay) => this.clearSubscriptionRetry(relay));
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
    const healthy = this.relays().some((relay) => isRelayLiveHealthy(relay));
    const minimum = healthy ? HEALTHY_FALLBACK_PULL_MIN_MS : FALLBACK_PULL_MIN_MS;
    const jitter = healthy ? HEALTHY_FALLBACK_PULL_JITTER_MS : FALLBACK_PULL_JITTER_MS;
    const delay = minimum + Math.floor(Math.random() * (jitter + 1));
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
    return orderRelays(this.relays());
  }

  private async pullRoutineRecords(secret: Uint8Array, relays: string[], waitForAll: boolean): Promise<void> {
    const generation = this.generation;
    const identity = syncIdentity(secret);
    const secondaryDelay = waitForAll ? 0 : ROUTINE_SECONDARY_DELAY_MS;
    const primaryPulls = relays
      .slice(0, ROUTINE_PRIMARY_RELAY_COUNT)
      .map((relay) => this.pullRelay(secret, identity, relay));
    const secondaryPulls = relays
      .slice(ROUTINE_PRIMARY_RELAY_COUNT)
      .map(async (relay) => {
        if (secondaryDelay > 0) await wait(secondaryDelay);
        return this.pullRelay(secret, identity, relay);
      });
    const pulls = [...primaryPulls, ...secondaryPulls];
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
      const records = await withRelayQueryPool((pool) =>
        queryRelayRecords(pool, secret, identity, relay, ROUTINE_RELAY_TIMEOUT_MS));
      noteRelaySuccess(relay, Date.now() - startedAt);
      recordRelayPerformance(relay, "eose", Date.now() - startedAt);
      return { relay, records };
    } catch (error) {
      noteRelayFailure(relay);
      recordRelayPerformance(relay, "close", Date.now() - startedAt, "network-error");
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
          noteRelaySuccess(relay, Date.now() - startedAt);
          if (!firstSettled) {
            firstSettled = true;
            resolveFirst(true);
          }
          if (accepted.size >= required) {
            useGarageVaultStore.getState().acknowledgeOutbox(item.key, item.revision, observed);
          }
        }, () => {
          noteRelayFailure(relay);
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
  maxWait = BOOTSTRAP_TIMEOUT_MS,
  onFirstNonempty?: (records: ObservedGarageSyncRecord[]) => void | Promise<void>
): Promise<ObservedGarageSyncRecord[]> {
  return (await queryGarageRecordsDetailed(
    pool,
    secret,
    relays,
    maxWait,
    onFirstNonempty
  )).records;
}

export async function queryGarageRecordsDetailed(
  pool: SimplePool,
  secret: Uint8Array,
  relays: string[],
  maxWait = BOOTSTRAP_TIMEOUT_MS,
  onFirstNonempty?: (records: ObservedGarageSyncRecord[]) => void | Promise<void>,
  onProgress?: (progress: GarageRelayQueryProgress) => void
): Promise<GarageRecordQueryResult> {
  const orderedRelays = [...new Set(orderRelays(relays))];
  const reachableRelays = new Set<string>();
  const unavailableRelays = new Set<string>();
  const settledRelays = new Set<string>();
  let firstApplied = false;
  let firstCallbackError: unknown;
  const reportProgress = () => onProgress?.({
    pending: orderedRelays.length - settledRelays.size,
    reachable: reachableRelays.size,
    total: orderedRelays.length,
    unavailable: unavailableRelays.size
  });

  reportProgress();
  const queries = orderedRelays.map(async (relay): Promise<RelayPullResult> => {
    let records: ObservedGarageSyncRecord[];
    try {
      const result = await queryAuthorRecords(pool, relay, syncAuthors(secret), maxWait);
      records = decodeLatestRecords(result.events, secret);
      if (relayConnectionStatus(pool, relay) === false) unavailableRelays.add(relay);
      else reachableRelays.add(relay);
    } catch (error) {
      unavailableRelays.add(relay);
      settledRelays.add(relay);
      reportProgress();
      throw error;
    }
    settledRelays.add(relay);
    reportProgress();
    if (!firstApplied && records.length > 0) {
      firstApplied = true;
      try {
        await onFirstNonempty?.(records);
      } catch (error) {
        firstCallbackError = error;
        throw error;
      }
    }
    return { relay, records };
  });
  const results = await Promise.allSettled(queries);
  if (firstCallbackError) throw firstCallbackError;
  const records = mergeObservedRecords(results.flatMap(
    (result) => result.status === "fulfilled" ? result.value.records : []
  ));
  if (reachableRelays.size === 0 && records.length === 0) {
    throw new Error("No coordinator relay is available.");
  }
  return {
    records,
    reachableRelays: orderedRelays.filter((relay) => reachableRelays.has(relay)),
    unavailableRelays: orderedRelays.filter((relay) => unavailableRelays.has(relay))
  };
}

async function queryRelayRecords(
  pool: SimplePool,
  secret: Uint8Array,
  identity: string,
  relay: string,
  maxWait: number
): Promise<ObservedGarageSyncRecord[]> {
  const queryStartedAt = Math.floor(Date.now() / 1000);
  const domains = syncDomainAuthors(secret);
  const cursors = domains.map(({ domain }) => ({ domain, cursor: readPullCursor(identity, relay, domain) }));
  const full = cursors.some(({ cursor }) => !cursor || Date.now() - cursor.lastFullAt >= FULL_PULL_INTERVAL_MS);
  const since = full
    ? undefined
    : Math.max(0, Math.min(...cursors.map(({ cursor }) => cursor?.since ?? 0)) - CURSOR_OVERLAP_SECONDS);
  const result = await queryAuthorRecords(
    pool,
    relay,
    domains.map(({ author }) => author),
    maxWait,
    since
  );
  if (result.complete) {
    cursors.forEach(({ domain, cursor }) => {
      writePullCursor(identity, relay, domain, {
        since: queryStartedAt,
        lastFullAt: full ? Date.now() : cursor?.lastFullAt ?? Date.now()
      });
    });
  }
  return decodeLatestRecords(result.events, secret);
}

type PagedEventQuery = {
  events: Event[];
  complete: boolean;
};

async function queryAuthorRecords(
  pool: SimplePool,
  relay: string,
  authors: string[],
  maxWait: number,
  since?: number
): Promise<PagedEventQuery> {
  const deadline = Date.now() + maxWait;
  const events = new Map<string, Event>();
  let until: number | undefined;
  while (events.size < GARAGE_SYNC_LIMITS.queryRecords && Date.now() < deadline) {
    const remainingWait = Math.max(1, deadline - Date.now());
    const page = await runRelayQuery(relay, () => pool.querySync([relay], {
      authors,
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
  coordinators: CoordinatorSummary[],
  options: GarageRecoveryOptions | GarageRecoveryOptions["onFirstSnapshot"] = {}
): Promise<GarageRecoverySnapshot> {
  return withRelayQueryPool((pool) =>
    recoverGarageSnapshotWithPool(pool, secret, coordinators, options)
  );
}

export async function recoverGarageSnapshotWithPool(
  pool: SimplePool,
  secret: Uint8Array,
  coordinators: CoordinatorSummary[],
  options: GarageRecoveryOptions | GarageRecoveryOptions["onFirstSnapshot"] = {},
  emptyRetryDelaysMs: readonly number[] = RECOVERY_EMPTY_RETRY_DELAYS_MS
): Promise<GarageRecoverySnapshot> {
  const callbacks: GarageRecoveryOptions = typeof options === "function"
    ? { onFirstSnapshot: options }
    : options;
  const relays = garageRelayUrls(coordinators);
  if (relays.length === 0) throw new Error("No coordinator is available. Check your connection and try again.");

  let records: ObservedGarageSyncRecord[] = [];
  let lastQueryError: unknown;
  const reachableRelays = new Set<string>();
  const unavailableRelays = new Set<string>();

  for (let attempt = 0; attempt <= emptyRetryDelaysMs.length; attempt += 1) {
    if (attempt > 0) await waitForRecoveryRetry(emptyRetryDelaysMs[attempt - 1] ?? 0);

    let result: GarageRecordQueryResult;
    try {
      result = await queryGarageRecordsDetailed(
        pool,
        secret,
        relays,
        RECOVERY_RELAY_TIMEOUT_MS,
        undefined,
        callbacks.onProgress
      );
    } catch (error) {
      lastQueryError = error;
      for (const relay of relays) {
        if (relayConnectionStatus(pool, relay) === false) unavailableRelays.add(relay);
      }
      if (attempt < emptyRetryDelaysMs.length) continue;
      if (reachableRelays.size === 0) throw error;
      break;
    }

    for (const relay of result.reachableRelays) {
      reachableRelays.add(relay);
      unavailableRelays.delete(relay);
    }
    for (const relay of result.unavailableRelays) {
      unavailableRelays.add(relay);
    }
    records = mergeObservedRecords([...records, ...result.records]);

    if (hasGarageManifestRecord(records)) break;
  }

  if (records.length === 0) {
    if (unavailableRelays.size > 0) {
      const reachable = reachableRelays.size;
      const unavailable = unavailableRelays.size;
      throw new Error(
        `No Fleet was found on ${reachable} reachable coordinator ${reachable === 1 ? "relay" : "relays"}. `
        + `${unavailable} ${unavailable === 1 ? "relay is" : "relays are"} unavailable, so recovery is not conclusive. `
        + "Retry when they reconnect."
      );
    }
    if (reachableRelays.size === 0 && lastQueryError) {
      throw lastQueryError;
    }
    throw new Error("No Fleet was found for this key. Check the key and connection, then try again.");
  }
  if (!hasGarageManifestRecord(records) && unavailableRelays.size > 0) {
    const unavailable = unavailableRelays.size;
    throw new Error(
      `Only part of this Fleet was found while ${unavailable} coordinator `
      + `${unavailable === 1 ? "relay is" : "relays are"} unavailable. `
      + "Nothing was restored yet; retry when the connection improves."
    );
  }

  const snapshot = recoverySnapshotFromRecords(secret, records);
  await callbacks.onFirstSnapshot?.(snapshot);
  const result = {
    records,
    reachableRelays: relays.filter((relay) => reachableRelays.has(relay)),
    unavailableRelays: relays.filter((relay) => unavailableRelays.has(relay))
  };
  await callbacks.onRecordsComplete?.(records, result);
  return snapshot;
}

function waitForRecoveryRetry(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

function hasGarageManifestRecord(records: ObservedGarageSyncRecord[]): boolean {
  return records.some(({ record }) =>
    record.type === "robot" || record.type === "robot-tombstone"
  );
}

function relayConnectionStatus(pool: SimplePool, relay: string): boolean | undefined {
  const readStatuses = (
    pool as SimplePool & { listConnectionStatus?: () => Map<string, boolean> }
  ).listConnectionStatus;
  if (typeof readStatuses !== "function") return undefined;
  return readStatuses.call(pool).get(normalizeURL(relay));
}

export function stopGarageSyncSchedule(): void {
  garageSyncEngine.stop();
}

function syncAuthors(secret: Uint8Array): string[] {
  return syncDomainAuthors(secret).map(({ author }) => author);
}

function syncDomainAuthors(secret: Uint8Array): Array<{ domain: SyncDomain; author: string }> {
  return (["garage-sync", "settings-sync", "history-sync"] as const).map((domain) => ({
    domain,
    author: getPublicKey(deriveGarageDomainKey(secret, domain))
  }));
}

function eventDomain(event: Event, secret: Uint8Array): GarageKeyDomain | undefined {
  if (event.pubkey === getPublicKey(deriveGarageDomainKey(secret, "garage-sync"))) return "garage-sync";
  if (event.pubkey === getPublicKey(deriveGarageDomainKey(secret, "settings-sync"))) return "settings-sync";
  if (event.pubkey === getPublicKey(deriveGarageDomainKey(secret, "history-sync"))) return "history-sync";
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

function recordPriority(record: GarageSyncRecord): number {
  if (record.type === "robot-tombstone") return 0;
  if (record.type === "robot") return 1;
  if (record.type === "preset-tombstone") return 2;
  if (record.type === "preset") return 3;
  if (record.type === "preferences") return 4;
  return 5;
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
