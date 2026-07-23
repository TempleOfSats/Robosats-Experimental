# Tor Smoothness Implementation Plan

## Status

Implemented on `feature-pro-workspace-backbone`.

Do not commit this file unless explicitly requested. The remaining unchecked items require physical-device validation.

## 1. Objective

Make user actions, trade state, robot state, the orderbook, and Fleet synchronization feel immediate and predictable over Tor without changing coordinator backends or RoboSats 0.8.3 API behavior.

The implementation must improve:

* Standard Garage robot refresh.
* PRO Fleet reconciliation and cross-device synchronization.
* Order creation, taking, bond, invoice, payment, chat, pause, resume, cancel, and renewal feedback.
* Orderbook first paint and eventual completeness.
* Android, iOS, browser, and Tauri behavior after startup, reconnect, resume, and network changes.

The implementation must not:

* Treat Nostr data as authoritative trade state.
* Permit a robot to start another order before coordinator verification completes.
* Reset Arti because one coordinator is unavailable.
* Let background discovery delay a user action.
* Replace cache-first rendering with blocking network loading.
* Add coordinator API or relay requirements.
* Expose relay, synchronization, or transport internals in ordinary UI.
* Regress standard Garage behavior while PRO is disabled.

## 2. Current baseline

### 2.1 Existing strengths to preserve

* `apiWebClient.ts` coalesces identical in-flight GET requests.
* Native requests have IDs, timeouts, and cancellation through `androidBridge.ts`.
* Order action responses are applied immediately to Garage and PRO state.
* `OrderPage` refreshes on visibility, native resume, Tor reconnect, and browser online events.
* Orderbook data renders from cache first and accepts progressive Nostr updates.
* Foreground Nostr traffic shares one `SimplePool` and therefore one WebSocket per relay.
* Fleet synchronization has encrypted independent records, an outbox, cursor overlap, relay replication, and deterministic conflict resolution.
* PRO reconciliation already limits robot workers to three and order workers to two.

### 2.2 Confirmed bottlenecks

| Path | Current behavior | Consequence |
| --- | --- | --- |
| PRO reconciliation | Three robot workers can each query every coordinator | Four coordinators can produce twelve simultaneous `/api/robot/` calls before order requests |
| Fleet restore | A fresh sixteen-robot Fleet may discover every robot against every coordinator | Up to sixty-four robot requests compete for Tor capacity |
| Standard Garage | `refreshRobotSlot` runs all coordinator requests with unbounded `Promise.all` | One robot can create a request burst and the slot updates only after the slowest request |
| Federation | Every coordinator starts `/api/info/` and `/api/limits/` together | Eight onion requests can start at once for four coordinators |
| Fleet relay query | Garage and settings authors are queried separately on each relay | Extra REQ round trips and serial relay work |
| Fleet synchronization | The live subscription is closed during pull and publication | Events can arrive during avoidable subscription gaps |
| Fleet fallback | Full synchronization runs every thirty to sixty seconds even when live relay subscriptions are healthy | Routine work competes with trade and chat traffic |
| Chat | REST consistency polling runs every fifteen seconds while WebSocket chat is connected | Redundant onion requests continue during a healthy live session |
| Orderbook | Fixed relay fallback timers fan out quickly, especially on iOS | Healthy primary relays do not prevent unnecessary additional connections |
| Android and Tauri health | Health checks only test the loopback SOCKS listener | Arti can appear healthy while onion routing is unusable |
| Android relay selection | Notification relays are shuffled on each connection | Relay quality is ignored and startup latency varies |
| iOS HTTP | Every request opens a new SOCKS stream and sends `Connection: close` | Every request pays connection setup cost and cannot reuse an established onion path |

## 3. Non-negotiable state rules

### 3.1 Authority

Only authenticated coordinator API responses may establish:

* Whether a robot is free.
* Whether an order is public, paused, active, renewable, cancelled, expired, or terminal.
* Whether a financial action succeeded.

Nostr events may only schedule an API refresh or update encrypted Fleet configuration records.

### 3.2 One robot, one relevant order

A robot remains unavailable while any coordinator check is pending after startup, restore, reconnect, or an ambiguous request failure.

The availability sequence is:

```text
unknown -> checking -> ready
unknown -> checking -> reserved
unknown -> checking -> stale
```

`ready` requires successful authoritative checks for every coordinator that could contain an order for that robot. A known active coordinator is checked first for presentation speed, but that result does not bypass the complete availability guard.

### 3.3 Failure behavior

* Preserve the last known state when a network request fails.
* Mark presentation data stale without inventing a terminal state.
* Never convert a timeout into cancellation, expiry, release, or readiness.
* Remove cancelled or terminal entries only after an authoritative response or an already-cancelled coordinator error already recognized by the order layer.
* Manual refresh may show a concise error. Automatic background failure remains quiet.

### 3.4 Foreground actions

The following work always outranks background work:

* Create or take an order.
* Lock a bond or invoice.
* Submit payment, payout, escrow, dispute, or chat data.
* Pause, resume, cancel, renew, or release.
* Refresh the currently open trade.

No queued background operation may start while an action is waiting for transport capacity.

## 4. Target architecture

Add one coordinator HTTP scheduler and one shared relay-health registry.

```text
UI or store
  -> ApiClient request metadata
  -> CoordinatorRequestScheduler
  -> browser/native transport
  -> coordinator

Nostr consumer
  -> SharedRelayPool
  -> RelayHealthRegistry
  -> orderbook, Fleet sync, notifications
```

The coordinator scheduler controls HTTP request admission only. It must not serialize or close Nostr WebSockets.

New modules:

```text
src/domains/transport/requestScheduler.ts
src/domains/transport/requestScheduler.test.ts
src/domains/transport/transportHealth.ts
src/domains/transport/transportHealth.test.ts
src/domains/nostr/relayHealth.ts
src/domains/nostr/relayHealth.test.ts
src/domains/diagnostics/networkPerformance.ts
src/domains/diagnostics/networkPerformance.test.ts
```

## 5. Phase 1: coordinator request scheduler

### 5.1 Request metadata

Extend `src/domains/transport/apiClient.ts`:

```ts
export type RequestPriority =
  | "action"
  | "foreground"
  | "visible"
  | "background"
  | "maintenance";

export type RequestSource =
  | "order-action"
  | "order-refresh"
  | "chat"
  | "robot-refresh"
  | "federation"
  | "orderbook-fallback"
  | "fleet-reconcile"
  | "prewarm"
  | "manual";

export interface ApiRequestOptions {
  timeoutProfile?: TimeoutProfile;
  timeoutMs?: number;
  priority?: RequestPriority;
  source?: RequestSource;
  signal?: AbortSignal;
}
```

Do not expose scheduler configuration to UI components.

Default priorities:

| Request | Default |
| --- | --- |
| `POST`, `PUT`, `DELETE` | `action` |
| GET with action timeout profile | `foreground` |
| GET with interactive timeout profile | `visible` |
| GET with background timeout profile | `background` |

Call sites must still set explicit priorities where behavior matters. Defaults are only a compatibility fallback.

### 5.2 Scheduler contract

Implement:

```ts
export type ScheduledRequest<T> = {
  promise: Promise<T>;
  promote(priority: RequestPriority): void;
  cancel(reason?: string): void;
};

export type ScheduleRequestOptions = {
  key?: string;
  origin: string;
  method: string;
  priority: RequestPriority;
  source: RequestSource;
  signal?: AbortSignal;
};

export interface CoordinatorRequestScheduler {
  schedule<T>(
    options: ScheduleRequestOptions,
    execute: () => Promise<T>
  ): ScheduledRequest<T>;
}
```

Required behavior:

* Coalesce identical GETs using the existing normalized URL and authorization-header key.
* Never coalesce state-changing requests.
* Promote a queued coalesced GET when a higher-priority caller requests the same resource.
* Do not abort an in-flight background request merely because an action arrives.
* Reserve one global slot from background and maintenance work so an action can start immediately.
* When all action-capable slots are occupied, stop admitting new lower-priority work until the action queue drains.
* Preserve FIFO ordering among requests with equal priority.
* After five consecutive action or foreground admissions, admit one waiting visible request when no action is queued.
* Background fairness must never override an awaiting action.
* Remove aborted queued work without invoking `execute`.
* Forward cancellation to an in-flight native or browser request through the existing `AbortSignal` and native cancellation bridge.

### 5.3 Capacity

Use these initial budgets:

```ts
type SchedulerCapacity = {
  total: number;
  background: number;
  perOrigin: number;
};

const MOBILE_CAPACITY = {
  total: 3,
  background: 2,
  perOrigin: 2
} satisfies SchedulerCapacity;

const DESKTOP_CAPACITY = {
  total: 4,
  background: 3,
  perOrigin: 2
} satisfies SchedulerCapacity;
```

Apply mobile capacity to Android and iOS. Apply desktop capacity to browsers and Tauri.

Do not use network type, viewport size, or user agent guessing. Add or reuse a platform capability helper in `src/app/platform.ts`.

### 5.4 Integration

Modify `src/domains/transport/apiWebClient.ts`:

* Move `inFlightGets` ownership into `requestScheduler.ts`.
* Build the request key before scheduling.
* Schedule around `transportRequest`, not around JSON parsing.
* Record queue start, transport start, first completion, and final completion in `networkPerformance.ts`.
* Keep current timeout profiles.
* A timeout begins when transport starts, not while a low-priority request waits in the queue.
* A caller-supplied abort signal applies both while queued and in flight.

Required call-site mappings:

```text
src/domains/orders/orderApi.ts
  submit action                 action / order-action
  visible order GET             foreground / order-refresh
  background order GET          background / order-refresh

src/domains/chat/chatApi.ts
  send message                  action / chat
  visible catch-up              foreground / chat
  consistency fallback          background / chat

src/domains/garage/robotApi.ts
  selected robot                visible / robot-refresh
  Fleet reconciliation          background / fleet-reconcile
  availability guard            foreground / robot-refresh

src/domains/coordinators/coordinatorApi.ts
  coordinator details dialog    visible / federation
  periodic refresh              maintenance / federation
```

### 5.5 Tests

Add deterministic fake-timer tests for:

* Mobile and desktop global limits.
* Per-origin limit.
* Reserved action slot.
* Priority ordering.
* FIFO ordering within one priority.
* Equal GET coalescing.
* Promotion of a queued background GET.
* No coalescing across different auth headers.
* Queued abort.
* In-flight abort.
* Timeout starts after admission.
* One rejected request releases capacity exactly once.
* A lower-priority request cannot starve indefinitely when action traffic stops.

Phase 1 acceptance:

* A sixteen-robot Fleet never has more than two background coordinator requests in flight on Android or iOS.
* A create, take, bond, payment, or chat action always has one reserved transport slot.
* Existing API response parsing and user errors remain unchanged.

TODO:

* [x] Add request metadata types.
* [x] Implement scheduler and tests.
* [x] Move GET coalescing into the scheduler.
* [x] Add explicit priority to all order, chat, robot, and federation call sites.
* [x] Verify native cancellation still removes pending bridge requests.

## 6. Phase 2: progressive coordinator updates

### 6.1 Robot refresh API

Extend the Garage refresh contract in `src/domains/garage/garageStore.ts`:

```ts
export type RefreshRobotSlotOptions = {
  priority?: RequestPriority;
  source?: RequestSource;
  preferredAliases?: string[];
  requireCompleteAvailability?: boolean;
};

refreshRobotSlot(
  token: string,
  coordinators: CoordinatorSummary[],
  options?: RefreshRobotSlotOptions
): Promise<RefreshRobotSlotResult>;
```

Default `requireCompleteAvailability` to `true` for startup, restore, create, take, and Fleet reconciliation.

### 6.2 Execution order

Sort enabled coordinators before launching requests:

1. Coordinator containing the known active order.
2. Coordinator containing the known last or renewable order.
3. Explicit `preferredAliases` in caller order.
4. Coordinators with a recent successful robot response.
5. Remaining enabled coordinators in stable federation order.

The scheduler controls actual concurrency. Do not add another `Promise.all` fan-out limiter inside the store.

### 6.3 Progressive store application

Replace the current all-at-once result application with per-coordinator commits.

For each coordinator completion:

```ts
set((state) => applyCoordinatorRobotResult(
  state,
  slot.token,
  coordinator.shortAlias,
  result
));
```

Maintain refresh bookkeeping outside persisted robot records:

```ts
type RobotRefreshSession = {
  id: string;
  pendingAliases: Set<string>;
  completedAliases: Set<string>;
  authoritativeAliases: Set<string>;
  startedAt: number;
};
```

Rules:

* Ignore a late result when its session ID is no longer current for that slot and coordinator.
* Keep `slot.loading` true while at least one required coordinator remains pending.
* Clear a coordinator row's loading state immediately when that coordinator settles.
* Preserve its previous record on a network failure and attach a stale error.
* Do not persist transient session IDs or pending sets.
* Persist each authoritative result as it arrives so a process termination does not discard completed work.
* Resolve the returned promise after all required checks settle.
* If no coordinator request succeeds, reject with an aggregate refresh error while preserving old state.

### 6.4 Availability

Update `src/domains/garage/robotAvailability.ts` and `src/domains/orders/robotOrderGuard.ts`:

* `checking` is unavailable.
* A partial successful refresh remains unavailable when `requireCompleteAvailability` is true.
* An explicit order coordinator response may immediately update the visible order row, but cannot mark the robot ready until required discovery completes.
* Create and take selectors must continue using the central availability rule.

### 6.5 Standard Garage

In `src/app/prewarm.ts`:

* Refresh the selected standard robot first.
* Pass the active coordinator alias as preferred when available.
* Do not wait for federation-wide metadata before starting a selected robot refresh if cached coordinator URLs are present.
* On focus, resume, online, or Tor reconnect, coalesce identical refresh triggers for 750 milliseconds.
* If an order page is open, skip generic selected-robot prewarm because the visible order refresh has higher priority.

### 6.6 PRO reconciliation

In `src/domains/pro/garageReconciler.ts`:

* Keep `maxRobotRequests` as logical robot workers.
* Let the shared HTTP scheduler enforce actual network concurrency.
* Pass known order coordinator aliases as `preferredAliases`.
* Apply coordinator and order snapshots progressively.
* Reconcile a known active order immediately after its robot response instead of waiting for unrelated coordinator checks.
* Keep offer creation and order taking blocked until complete robot availability verification.
* Preserve the existing generation and stale-response protections.

### 6.7 Federation refresh

Refactor `src/domains/coordinators/federationStore.ts`:

* Schedule coordinator refreshes as maintenance requests.
* Update each coordinator in Zustand as soon as `/info` and `/limits` for that coordinator settle.
* Keep `/info` and `/limits` concurrent within one coordinator because they share one per-origin budget of two.
* Set global `lastRefreshed` only after every enabled coordinator settles.
* Preserve per-coordinator retry cooldown.
* Persist cache after each coordinator update, not only at final completion.
* A slow coordinator must not delay another coordinator becoming visibly online.

### 6.8 Tests

Add tests proving:

* The preferred coordinator starts first.
* A fast coordinator updates the store before a slow coordinator finishes.
* A late obsolete session cannot overwrite a newer session.
* One failed coordinator preserves its previous record.
* The slot remains unavailable while required checks are pending.
* The slot becomes ready only after complete authoritative verification.
* A known active order is visible before unrelated discovery finishes.
* Federation state updates progressively and `lastRefreshed` remains final-batch metadata.

TODO:

* [x] Add robot refresh options and session bookkeeping.
* [x] Apply coordinator results progressively.
* [x] Centralize availability handling for partial refreshes.
* [x] Prioritize known coordinators in standard Garage and PRO.
* [x] Make federation refresh progressive.

## 7. Phase 3: route-aware reconciliation

### 7.1 One refresh intent bus

Create a lightweight coordinator refresh intent module:

```text
src/domains/transport/refreshIntents.ts
src/domains/transport/refreshIntents.test.ts
```

```ts
export type RefreshIntent =
  | { type: "order"; locator: OrderLocator; reason: RefreshReason }
  | { type: "robot"; token: string; preferredAlias?: string; reason: RefreshReason }
  | { type: "orderbook"; reason: RefreshReason }
  | { type: "fleet"; reason: RefreshReason };

export type RefreshReason =
  | "action"
  | "nostr"
  | "resume"
  | "focus"
  | "online"
  | "tor-reconnected"
  | "manual";
```

This bus coalesces intent only. It does not contain trade state.

Coalescing keys:

```text
order: shortAlias + orderId + token hash
robot: token hash
orderbook: singleton
fleet: singleton
```

Coalescing windows:

| Reason | Window |
| --- | --- |
| action | none |
| manual | none |
| nostr | 250 ms |
| resume, focus, online, Tor reconnect | 750 ms |

### 7.2 Event routing

* Order action completion applies the response first, then emits a low-cost verification intent only when the returned payload is incomplete.
* Nostr kind `1059` emits a prioritized order intent when an order locator is available.
* Resume and reconnect emit one visible route intent, not simultaneous order, robot, orderbook, and federation refreshes.
* The currently visible route wins:
  * Order route: order first, then owning robot.
  * Pro Desk: stale or attention rows first, then remaining Fleet robots.
  * Standard Garage: selected robot first.
  * Offers: orderbook first.
  * Settings or coordinators: federation first.
* Generic prewarm starts only after the visible-route request is admitted.

### 7.3 Lifecycle

Centralize browser and native lifecycle listeners. Do not leave independent listeners in `prewarm.ts`, `OrderPage`, chat, and PRO reconciliation that all launch work directly.

Components may subscribe to intents, but the lifecycle source must emit once per event.

TODO:

* [x] Implement refresh-intent coalescing.
* [x] Route lifecycle events through the intent bus.
* [x] Remove duplicate direct resume, focus, online, and reconnect launches.
* [x] Preserve immediate local action-result ingestion.

## 8. Phase 4: Fleet synchronization

Target modules:

```text
src/domains/pro/garageSync.ts
src/domains/pro/garageSync.test.ts
src/domains/pro/garageSyncRuntime.test.ts
src/domains/nostr/sharedRelayPool.ts
src/domains/nostr/relayHealth.ts
```

### 8.1 Combined author queries

Replace one query per author with one paged query per relay.

```ts
const authors = syncAuthors(secret);

pool.querySync([relay], {
  authors,
  kinds: [APPLICATION_DATA_KIND],
  since: sharedSince,
  until,
  limit: GARAGE_SYNC_LIMITS.queryPageRecords
});
```

Cursor rules:

* Continue storing a cursor per domain because Garage and settings evolve independently.
* For an incremental query, use the earliest required `since` among both domains minus the existing overlap.
* If either domain requires a daily full pull, perform one full combined-author query.
* After a complete page traversal, advance each domain cursor only to the query start time.
* If pagination is incomplete, do not advance either affected cursor.
* Decode and route each event to its domain after retrieval.

This may overfetch a small number of events from one author but removes an entire relay round trip.

### 8.2 Keep the live subscription open

Remove `suspendSubscription()` from routine synchronization.

Required deduplication:

* The store already compares logical revision, writer device ID, event ID, and publication time.
* Pull and subscription paths must both call the same `applyRemoteRecords` function.
* Replaying an event observed live and then pulled must be idempotent.
* Reconfiguration or background pause may still replace or close the subscription.

### 8.3 Health-aware fallback

Track subscription health:

```ts
type LiveRelayState = {
  connectedAt?: number;
  lastEventAt?: number;
  lastEoseAt?: number;
  lastErrorAt?: number;
};
```

Fallback policy:

* Always pull on engine start, Fleet restore, foreground resume, online, Tor reconnect, and explicit Sync now.
* When at least one live relay is healthy, schedule the safety pull at three to five minutes with jitter.
* When no live relay is healthy, retain the thirty to sixty second fallback.
* A local mutation publishes after the existing debounce and does not wait for the fallback timer.
* Replication retries retain the current five-second to five-minute backoff.
* Reading data does not publish a heartbeat unless the existing heartbeat policy is due.

### 8.4 Recovery first result

During Fleet-key recovery:

* Query relays in health order.
* Apply the first valid nonempty result immediately.
* Render recovered robots and presets as `checking`.
* Continue merging remaining relay results in the background.
* Do not report recovery complete until local materialization succeeds.
* Start coordinator reconciliation immediately after first materialization.
* Do not mark robots ready until authoritative API verification completes.

An empty first relay is not proof of an empty Fleet. Continue until one nonempty result arrives or all relays settle.

### 8.5 Shared relay health

Move Fleet-local relay health into `src/domains/nostr/relayHealth.ts`.

```ts
export type RelayHealthSnapshot = {
  failures: number;
  latencyMs: number;
  lastSuccessAt: number;
  lastFailureAt: number;
};

export function noteRelaySuccess(relay: string, latencyMs: number): void;
export function noteRelayFailure(relay: string): void;
export function orderRelays(relays: string[]): string[];
```

Rules:

* Keep this registry memory-only initially.
* Normalize relay URLs before indexing.
* Decay failures after success.
* Do not infer event completeness from relay speed.
* Orderbook, Fleet sync, and foreground notifications consume the same ordering.

### 8.6 Tests

* One relay query contains both authors.
* Cursor overlap is preserved.
* A daily full pull occurs when either domain requires it.
* Live and pulled duplicate events apply once.
* Synchronization does not close a healthy subscription.
* Healthy live subscription moves fallback to three to five minutes.
* Failed live subscriptions retain thirty to sixty second fallback.
* First nonempty recovery result materializes before slow relays settle.
* Empty first relay does not complete recovery.
* Slow relay results merge without replacing a newer local revision.

TODO:

* [x] Add shared relay health registry.
* [x] Combine Fleet author queries.
* [x] Remove routine subscription suspension.
* [x] Add live health state and adaptive fallback.
* [x] Apply first valid recovery result progressively.

## 9. Phase 5: chat and order polling

### 9.1 Chat

Modify `src/domains/chat/ChatStagePanel.tsx` and `chatRefresh.ts`.

Polling intervals:

```ts
const CHAT_CONNECTED_BASE_MS = 60_000;
const CHAT_DISCONNECTED_BASE_MS = 8_000;
const CHAT_HIDDEN_BROWSER_BASE_MS = 120_000;
const CHAT_JITTER_RATIO = 0.15;
```

Behavior:

* Fetch immediately on mount.
* Fetch immediately after WebSocket open to close any reconnect gap.
* Fetch immediately on resume, visibility, online, and Tor reconnect through refresh intents.
* While WebSocket is open, use sixty-second REST consistency polling.
* While disconnected and visible, use eight-second REST fallback polling.
* In native background state, stop JS chat polling because the native notification service remains responsible for wake-up hints.
* In a hidden ordinary browser tab, use a two-minute safety poll.
* Add plus or minus fifteen percent jitter after every scheduled poll.
* Reset backoff after any valid socket frame or successful REST response.
* Add jitter to the existing 1.5-second to 30-second socket reconnect backoff.
* Continue deduplicating messages by message ID or stable encrypted-message identity.

### 9.2 Order polling

Keep current foreground intervals for critical states unless measurements show they are excessive.

Change hidden behavior:

* Stop routine order polling while a native app is backgrounded.
* Use at least a five-minute safety interval for hidden ordinary browser tabs.
* Refresh immediately when visible again.
* Add plus or minus ten percent jitter to recurring foreground polling.
* Do not schedule an immediate GET after a complete action response that has already been applied.
* Schedule immediate verification when an action response lacks status or required order fields.
* Keep status `0` and `3` at the current three-second foreground cadence.
* Keep invoice, payment, escrow, and dispute stages at their current foreground cadence.

### 9.3 Tests

* Connected chat uses sixty-second fallback.
* Disconnected chat uses eight-second fallback.
* Socket open causes one immediate catch-up.
* Hidden native chat stops polling.
* Visible resume triggers one coalesced fetch.
* Complete action response suppresses duplicate immediate GET.
* Incomplete action response schedules verification.
* Jitter remains inside configured bounds under fake timers.

TODO:

* [x] Reduce connected chat polling.
* [x] Add reconnect catch-up and jitter.
* [x] Pause native hidden polling.
* [x] Make action-result verification conditional.

## 10. Phase 6: adaptive orderbook relay hedging

Target modules:

```text
src/domains/orderbook/nostrOrderbook.ts
src/domains/orderbook/nostrOrderbook.test.ts
src/domains/orderbook/orderbookStore.ts
src/domains/nostr/relayHealth.ts
```

### 10.1 Relay ordering

Order candidates by:

1. Current application host relay when available and healthy.
2. Shared relay-health score.
3. Stable configured coordinator order.

Do not randomize order on every refresh.

### 10.2 Hedge schedule

Use at most three relays.

```ts
const PRIMARY_SILENCE_MS = 2_000;
const SECONDARY_SILENCE_MS = 4_500;
const EVENTUAL_COMPLETENESS_MS = 8_000;
```

Algorithm:

1. Start snapshot and live subscription on the primary relay immediately.
2. Render the first valid event batch immediately using the existing 350-millisecond batching.
3. Start the secondary relay when the primary errors, remains silent for two seconds, or reaches EOSE, whichever happens first.
4. Start the third relay when both earlier relays error, no valid data exists after 4.5 seconds, or after eight seconds for eventual completeness.
5. Do not cancel a healthy primary after rendering.
6. Once opened, keep live subscriptions subject to the existing idle-close behavior.
7. Record EOSE, first-event, error, and final snapshot timing in the shared relay-health registry.

This preserves eventual federation coverage while reducing immediate connection bursts.

### 10.3 Cache behavior

Keep:

* Existing orderbook cache max age.
* Immediate cached rendering.
* In-flight store refresh coalescing.
* Progressive updates.
* Failure cooldown.

Never block the orderbook on federation metadata refresh.

### 10.4 Tests

* Primary starts immediately.
* Secondary starts on silence, failure, or EOSE.
* Third relay is delayed when useful data arrives.
* Third relay still starts for eventual completeness.
* Cached offers render before relay completion.
* iOS no longer uses a special aggressive fan-out schedule.
* Shared health ordering is deterministic.

TODO:

* [x] Replace platform-specific fixed fallback timers.
* [x] Consume shared relay health.
* [x] Add EOSE-aware hedging.
* [x] Preserve eventual third-relay coverage.

## 11. Phase 7: end-to-end Tor health

### 11.1 Failure classification

Implement `src/domains/transport/transportHealth.ts`.

Track only sanitized origin-level outcomes:

```ts
type TransportFailure = {
  originKey: string;
  at: number;
  category: "timeout" | "connect" | "socket" | "http";
};
```

Rules:

* HTTP 4xx and 5xx prove transport reachability and must not count as Tor transport failures.
* Timeouts, connection failures, and socket failures count.
* One coordinator failure does not trigger a Tor probe.
* Two distinct coordinator origins failing within thirty seconds trigger one single-flight end-to-end probe.
* Any successful coordinator or relay connection clears the cross-origin failure window.
* Probe state remains memory-only.

### 11.2 Probe

Probe two enabled coordinator `/api/info/` endpoints through the existing Tor transport, in relay-health order, without authentication.

* Use a ten-second timeout per endpoint.
* Stop after the first successful HTTP response, including 4xx or 5xx.
* Do not let the probe occupy the reserved action slot.
* Do not probe user-supplied arbitrary paths.
* If every probe fails and the local SOCKS listener also fails, rebuild immediately.
* If every probe fails but SOCKS is listening, request one controlled Arti restart.
* Apply a two-minute restart cooldown.
* Keep restart single-flight.

### 11.3 Android

Target modules:

```text
android/app/src/main/java/com/robosats/Connectivity.kt
android/app/src/main/java/com/robosats/MainActivity.kt
android/app/src/main/java/com/robosats/WebAppInterface.kt
android/app/src/main/java/com/robosats/tor/ArtiTorManager.kt
android/app/src/main/java/com/robosats/net/NativeNetworkClient.kt
```

Changes:

* Wait for `NET_CAPABILITY_VALIDATED` before treating a replacement Android network as usable.
* Keep the existing network-change debounce.
* Do not rebuild Arti on every native HTTP failure.
* Add a bridge method for controlled recovery after the JS cross-origin probe fails.
* Keep the local SOCKS listener check as a cheap first check, not the final health test.
* Emit `robosats:tor-reconnected` only after Arti returns active.
* Ensure `MainActivity` and `NotificationsService` share one reset mutex and cooldown.

### 11.4 Tauri

Target modules:

```text
desktop/src-tauri/src/runtime.rs
desktop/src-tauri/src/lib.rs
src/domains/transport/tauriBridge.ts
```

Changes:

* Keep the loopback listener check for resume.
* Add a Tauri command for controlled restart after the JS end-to-end probe fails.
* Preserve `health_check_deferred` during bootstrap.
* Keep restart generation checks and exponential sidecar retry.
* Do not hide the main window or show the splash for one endpoint failure.

### 11.5 Tests

* One origin failure does not probe or restart.
* Two distinct origin failures trigger one probe.
* HTTP error response counts as reachable transport.
* Probe success prevents restart.
* Probe failure requests one restart.
* Restart cooldown prevents loops.
* Android waits for validated capability.
* Tauri bootstrap state defers health recovery.

TODO:

* [x] Classify transport failures.
* [x] Implement cross-origin probe.
* [x] Add Android controlled recovery bridge.
* [x] Add Tauri controlled recovery command.
* [x] Preserve restart cooldown and single-flight behavior.

## 12. Phase 8: iOS HTTP connection reuse

This is the highest-risk phase. Implement it only after Phases 1 through 7 pass browser, Android, and desktop validation.

Target module:

```text
ios/RoboSatsExp/Network/TorNetworkClient.swift
```

### 12.1 Pool

Add a per-origin connection pool:

```swift
private final class TorHTTPConnectionPool: @unchecked Sendable {
    struct Key: Hashable {
        let scheme: String
        let host: String
        let port: Int
        let socksPort: Int
    }

    func acquire(for key: Key) throws -> SOCKSStreamConnection
    func release(_ connection: SOCKSStreamConnection, for key: Key, reusable: Bool)
    func invalidate(for key: Key)
    func closeAll()
}
```

Initial limits:

```text
Maximum active connections per origin: 2
Maximum idle connections per origin: 1
Idle lifetime: 30 seconds
Maximum connection lifetime: 2 minutes
```

Use a lock or serial queue around pool state. Never share one stream concurrently between requests.

### 12.2 HTTP framing

Replace `readToEnd` as the normal response strategy.

Implement:

```swift
func readHeaders(maximumBytes: Int) throws -> ParsedResponseHead
func readExactly(_ count: Int) throws -> Data
func readChunkedBody(maximumBytes: Int) throws -> Data
func readUntilEOF(maximumBytes: Int) throws -> Data
```

Reuse rules:

* Send `Connection: keep-alive`.
* Reuse only when the response has a valid `Content-Length` or complete chunked framing.
* Do not reuse when the response requests `Connection: close`.
* Do not reuse an EOF-framed response.
* Do not reuse after malformed headers, truncated body, timeout, read error, or write error.
* Preserve the current sixteen-megabyte response limit.
* Preserve TLS destination-host certificate validation.
* Clear the pool when Arti restarts, the SOCKS port changes, the app backgrounds long enough to invalidate streams, or native transport is reset.

### 12.3 Retry behavior

* When a reused connection fails before any response headers arrive, close it and retry one idempotent GET on a fresh connection.
* Never automatically retry POST, PUT, or DELETE after bytes may have been written.
* Let the application-level action flow decide whether a state-changing request should be retried.

### 12.4 Validation

Add Swift tests if the existing project can host them without changing release packaging. Otherwise build a deterministic local test harness around a SOCKS-compatible fixture.

Required checks:

* Two sequential same-origin GETs use one SOCKS connection.
* Different origins never share a connection.
* Chunked and content-length bodies leave the next response correctly framed.
* EOF-framed response closes the connection.
* Stale reused GET retries once.
* POST is not replayed after ambiguous failure.
* Pool closes on Tor reset.
* Physical-device validation covers foreground, background, network switch, and coordinator failover.

TODO:

* [x] Add connection pool.
* [x] Add framed HTTP response reading.
* [x] Add conservative reuse rules.
* [x] Add GET-only stale retry.
* [x] Clear pool on transport lifecycle changes.
* [ ] Validate on physical iPhone.

## 13. Phase 9: notification relay stability

Target modules:

```text
android/app/src/main/java/com/robosats/models/NostrClient.kt
android/app/src/main/java/com/robosats/services/NotificationsService.kt
src/domains/nostr/relayHealth.ts
```

Android native code cannot directly consume the JS in-memory registry while the WebView is absent. Persist only a sanitized ordered relay list through the existing native federation bridge.

Selection rules:

1. Retain relays that were connected successfully during the previous service session.
2. Fill remaining slots from enabled coordinator relays in stable order.
3. Keep at most three notification relays.
4. Replace one relay only after repeated connection failures, not every service restart.
5. Do not persist event IDs, robot keys, order IDs, or subscription filters in relay-health preferences.

When the WebView is foregrounded, a native notification should emit a refresh intent for the relevant order instead of launching a competing native coordinator GET.

Do not remove the foreground service or its independent relay connections. They are required when the WebView is suspended.

TODO:

* [x] Replace random relay selection with sticky selection.
* [x] Persist sanitized relay success order.
* [x] Forward foreground notification hints into refresh intents.
* [ ] Verify background notifications still work with the WebView suspended.

## 14. Performance diagnostics

Implement a bounded memory-only ring buffer in `src/domains/diagnostics/networkPerformance.ts`.

```ts
export type NetworkPerformanceEntry = {
  id: string;
  source: RequestSource | "nostr";
  priority?: RequestPriority;
  originHash: string;
  queuedMs?: number;
  transportMs?: number;
  totalMs: number;
  outcome: "success" | "http-error" | "timeout" | "network-error" | "cancelled";
  cache?: "hit" | "miss";
  relayPhase?: "connect" | "first-event" | "eose" | "close";
  at: number;
};
```

Rules:

* Maximum 250 entries.
* Hash origins with an ephemeral per-process salt.
* Never store paths, query strings, order IDs, tokens, public keys, private keys, robot names, messages, payload sizes, or request bodies.
* No telemetry leaves the device.
* Expose a development-only console snapshot and optional sanitized diagnostics export.
* Do not add a normal settings control.

Metrics used for tuning:

* Scheduler queue p50 and p95 by source and priority.
* Coordinator transport p50 and p95.
* Orderbook cache-to-first-event and cache-to-EOSE.
* Fleet restore-to-first-record and restore-to-all-relays-settled.
* Chat socket reconnect and REST fallback frequency.
* Tor restart count per session.

Initial performance assertions:

* Action queue p95 remains below 100 milliseconds when the reserved slot is free.
* Progressive robot UI updates occur within 100 milliseconds of the fastest coordinator response.
* First valid Fleet relay data applies within 250 milliseconds of that relay query completing.
* Combined Fleet author queries halve routine Fleet REQ count per relay.
* Healthy chat WebSocket reduces consistency GET frequency from four per minute to one per minute.
* iOS sequential same-origin GETs avoid a second SOCKS handshake while the pooled connection is valid.

These are client-overhead targets. Do not assert absolute onion network completion times.

TODO:

* [x] Add privacy-safe ring buffer.
* [x] Instrument coordinator scheduler.
* [x] Instrument orderbook relay phases.
* [x] Instrument Fleet pull and publication phases.
* [x] Instrument Tor restart count.

## 15. Test strategy

### 15.1 Unit and store tests

Run after every phase:

```text
npm run typecheck
npm test
npm run build
```

Required suites:

```text
src/domains/transport/requestScheduler.test.ts
src/domains/transport/transportHealth.test.ts
src/domains/garage/garageStore.test.ts
src/domains/orders/robotOrderGuard.test.ts
src/domains/coordinators/federationStore.test.ts
src/domains/pro/garageReconciler.test.ts
src/domains/pro/garageSync.test.ts
src/domains/pro/garageSyncRuntime.test.ts
src/domains/chat/chatRefresh.test.ts
src/domains/orderbook/nostrOrderbook.test.ts
src/domains/nostr/sharedRelayPool.test.ts
src/domains/nostr/relayHealth.test.ts
```

Use controllable promises and fake timers. Do not use real internet access in unit tests.

### 15.2 Deterministic slow-network fixtures

Add test helpers that model:

```text
Coordinator A: 500 ms success
Coordinator B: 5 second success
Coordinator C: timeout
Coordinator D: 1.5 second API error
Relay A: first event at 400 ms, EOSE at 900 ms
Relay B: silent
Relay C: first event at 5 seconds
```

Assertions:

* Fast authoritative data appears without waiting for slow peers.
* User actions start while background work remains queued.
* Timeout preserves cached state.
* Nostr hints schedule API refresh without mutating order state.
* Late old responses cannot restore cancelled or obsolete orders.

### 15.3 Browser validation

Validate at:

```text
390 x 844
768 x 1024
1280 x 800
1440 x 900
```

Scenarios:

* Standard Garage initial load and robot switching.
* Fleet restore with zero, one, and sixteen robots.
* Add robot on one device and observe another device.
* Create and take while Fleet discovery is active.
* Cancel a public maker offer while background refresh is active.
* Chat reconnect with messages sent during disconnection.
* Orderbook cached first paint with one slow relay.
* Visibility hide and restore.
* Browser offline and online transition.

No new loading element may resize the Desk, orderbook, or trade controls.

### 15.4 Native validation

Android:

* Cold start over Wi-Fi.
* Wi-Fi to mobile transition.
* Background for five minutes, then resume.
* Coordinator failure while another coordinator remains available.
* Incoming chat and order-state notification while WebView is suspended.
* Action submitted while Fleet reconciliation is active.

iOS:

* Same scenarios as Android.
* Verify pooled connection lifecycle after Phase 8.
* Verify no request bypasses Arti.

Tauri:

* Linux AppImage, Windows installer, and macOS application.
* Resume with healthy SOCKS listener.
* Resume with dead sidecar.
* Multiple coordinator failures with successful end-to-end probe.
* Complete Tor failure followed by one controlled restart.

## 16. Rollout sequence

Implement in this order:

1. Diagnostics baseline and request scheduler.
2. Progressive Garage and federation updates.
3. Route-aware reconciliation and lifecycle coalescing.
4. Fleet combined queries, persistent subscription, and adaptive fallback.
5. Chat and order polling refinement.
6. Adaptive orderbook hedging and shared relay health.
7. End-to-end Tor health on Android and Tauri.
8. Sticky Android notification relays.
9. iOS connection pooling.

Each phase must be independently revertible. Do not combine the iOS transport rewrite with JavaScript scheduler or Fleet changes.

## 17. Definition of done

The work is complete only when:

* User actions have reserved coordinator transport capacity on every platform.
* Standard Garage and Fleet apply coordinator results progressively.
* A robot cannot be reused while complete availability verification is pending.
* Federation refresh no longer waits for the slowest coordinator before updating healthy entries.
* Fleet uses one combined-author query per relay page.
* Fleet synchronization does not close a healthy live subscription during routine work.
* Healthy Fleet subscriptions use a three-to-five-minute safety pull.
* Chat uses one-minute REST consistency checks while WebSocket is healthy.
* Order and chat polling stop or slow substantially in background state and refresh immediately on return.
* Orderbook relay fan-out is health-ranked and hedged while preserving eventual completeness.
* Android and Tauri distinguish a live SOCKS listener from usable onion transport.
* One coordinator outage cannot restart Arti.
* Android notifications use sticky relays rather than random selection.
* iOS reuses safe same-origin HTTP connections and never replays ambiguous state-changing requests.
* No backend change is required.
* Standard mode remains behaviorally unchanged except for faster, progressive refresh.
* Full unit, production build, browser, Android, iOS, and desktop validation passes.

## 18. Reference constraints

Implementation decisions should remain consistent with:

* [Arti client lifecycle and stream isolation](https://tpo.pages.torproject.net/core/doc/rust/arti_client/index.html)
* [Tor denial-of-service and onion-service cost considerations](https://spec.torproject.org/dos-spec/overview.html)
* [Tor stream separation performance considerations](https://spec.torproject.org/proposals/171-separate-streams.html)
* [NIP-01 relay connections, filters, and EOSE](https://github.com/nostr-protocol/nips/blob/master/01.md)
* [NIP-78 application-specific data](https://github.com/nostr-protocol/nips/blob/master/78.md)
* [OkHttp Dispatcher request limits](https://square.github.io/okhttp/5.x/okhttp/okhttp3/-dispatcher/index.html)
* [Android validated network capability](https://developer.android.com/develop/connectivity/network-ops/reading-network-state)
