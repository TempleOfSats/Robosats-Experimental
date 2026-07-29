import { matchFilter, type Filter } from "nostr-tools";
import type { SimplePool, SubCloser, SubscribeManyParams } from "nostr-tools/pool";

type SubscriptionPool = Pick<SimplePool, "subscribeMap">;

type LogicalSubscription = {
  id: number;
  filter: Filter;
  params: SubscribeManyParams;
};

type RelayState = {
  relay: string;
  subscriptions: Map<number, LogicalSubscription>;
  physical?: SubCloser;
  rebuildTimer?: ReturnType<typeof setTimeout>;
  rebuildReason?: string;
  generation: number;
  revision: number;
  appliedRevision: number;
  rebuilding?: Promise<void>;
};

type LiveRelaySubscriptionManagerOptions = {
  rebuildDelayMs?: number;
};

const DEFAULT_REBUILD_DELAY_MS = 50;

/**
 * Multiplexes all long-lived consumers into one multi-filter NIP-01 REQ per
 * relay. Short-lived queries can then share the same WebSocket without
 * exceeding strfry's default concurrent subscription budget.
 */
export class LiveRelaySubscriptionManager {
  private readonly relays = new Map<string, RelayState>();
  private nextLogicalId = 1;
  private nextPhysicalId = 1;
  private readonly rebuildDelayMs: number;

  constructor(
    private readonly pool: SubscriptionPool,
    options: LiveRelaySubscriptionManagerOptions = {}
  ) {
    this.rebuildDelayMs = Math.max(0, options.rebuildDelayMs ?? DEFAULT_REBUILD_DELAY_MS);
  }

  subscribeMany(relays: string[], filter: Filter, params: SubscribeManyParams): SubCloser {
    const closers = [...new Set(relays)].map((relay) => this.subscribeRelay(relay, filter, params));
    return {
      close: (reason?: string) => {
        closers.forEach((closer) => closer.close(reason));
      }
    };
  }

  reset(reason = "reset"): void {
    const states = [...this.relays.values()];
    this.relays.clear();
    states.forEach((state) => {
      if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
      state.rebuildTimer = undefined;
      state.generation += 1;
      void state.physical?.close(reason);
      state.physical = undefined;
      state.subscriptions.clear();
    });
  }

  private subscribeRelay(relay: string, filter: Filter, params: SubscribeManyParams): SubCloser {
    const state = this.relayState(relay);
    const id = this.nextLogicalId++;
    const logical = { id, filter, params };
    state.subscriptions.set(id, logical);
    this.requestRebuild(state);

    let closed = false;
    return {
      close: (reason?: string) => {
        if (closed) return;
        closed = true;
        if (state.subscriptions.get(id) !== logical) return;
        state.subscriptions.delete(id);
        this.requestRebuild(state, reason ?? "logical-subscription-closed");
      }
    };
  }

  private relayState(relay: string): RelayState {
    const existing = this.relays.get(relay);
    if (existing) return existing;
    const state: RelayState = {
      relay,
      subscriptions: new Map(),
      generation: 0,
      revision: 0,
      appliedRevision: -1
    };
    this.relays.set(relay, state);
    return state;
  }

  private requestRebuild(state: RelayState, reason = "filters-updated"): void {
    state.revision += 1;
    this.scheduleRebuild(state, reason);
  }

  private scheduleRebuild(state: RelayState, reason: string): void {
    state.rebuildReason = reason;
    if (state.rebuilding || state.rebuildTimer) return;
    if (this.rebuildDelayMs === 0) {
      this.ensureRebuild(state, reason);
      return;
    }
    state.rebuildTimer = setTimeout(() => {
      state.rebuildTimer = undefined;
      if (this.relays.get(state.relay) !== state) return;
      this.ensureRebuild(state, state.rebuildReason ?? "filters-updated");
    }, this.rebuildDelayMs);
  }

  private ensureRebuild(state: RelayState, reason: string): void {
    if (state.rebuilding) return;
    if (state.rebuildTimer) {
      clearTimeout(state.rebuildTimer);
      state.rebuildTimer = undefined;
    }
    state.rebuildReason = undefined;
    state.rebuilding = this.rebuild(state, reason).finally(() => {
      state.rebuilding = undefined;
      if (this.relays.get(state.relay) === state && state.revision !== state.appliedRevision) {
        this.scheduleRebuild(state, "filters-updated");
      }
    });
  }

  private async rebuild(state: RelayState, reason: string): Promise<void> {
    while (state.appliedRevision !== state.revision) {
      if (this.relays.get(state.relay) !== state) return;
      const targetRevision = state.revision;
      const previous = state.physical;
      state.physical = undefined;
      state.generation += 1;
      if (previous) await Promise.resolve(previous.close(reason));
      if (this.relays.get(state.relay) !== state) return;
      if (targetRevision !== state.revision) continue;

      const subscriptions = [...state.subscriptions.values()];
      if (subscriptions.length === 0) {
        state.appliedRevision = targetRevision;
        if (this.relays.get(state.relay) === state) this.relays.delete(state.relay);
        continue;
      }

      const generation = ++state.generation;
      let physical: SubCloser;
      physical = this.pool.subscribeMap(
        subscriptions.map(({ filter }) => ({ url: state.relay, filter })),
        {
          id: `robosats-live-${this.nextPhysicalId++}`,
          ...maxWaitParams(subscriptions),
          onevent: (event) => {
            if (!this.isCurrent(state, generation, physical)) return;
            subscriptions.forEach((logical) => {
              if (state.subscriptions.get(logical.id) === logical && matchFilter(logical.filter, event)) {
                logical.params.onevent?.(event);
              }
            });
          },
          oninvalidevent: (event) => {
            if (!this.isCurrent(state, generation, physical)) return;
            subscriptions.forEach((logical) => logical.params.oninvalidevent?.(event));
          },
          oneose: () => {
            if (!this.isCurrent(state, generation, physical)) return;
            subscriptions.forEach((logical) => {
              if (state.subscriptions.get(logical.id) === logical) logical.params.oneose?.();
            });
          },
          onclose: (reasons) => {
            if (!this.isCurrent(state, generation, physical)) return;
            state.physical = undefined;
            state.generation += 1;
            subscriptions.forEach((logical) => {
              if (state.subscriptions.get(logical.id) !== logical) return;
              state.subscriptions.delete(logical.id);
              logical.params.onclose?.(reasons);
            });
            this.requestRebuild(state, "relay-closed");
          }
        }
      );
      state.physical = physical;
      state.appliedRevision = targetRevision;
    }
  }

  private isCurrent(state: RelayState, generation: number, physical: SubCloser): boolean {
    return this.relays.get(state.relay) === state
      && state.generation === generation
      && state.physical === physical;
  }
}

function maxWaitParams(subscriptions: LogicalSubscription[]): Pick<SubscribeManyParams, "maxWait"> {
  const waits = subscriptions.flatMap(({ params }) =>
    typeof params.maxWait === "number" ? [params.maxWait] : []);
  return waits.length > 0 ? { maxWait: Math.max(...waits) } : {};
}

export type LiveRelaySubscriptions = Pick<LiveRelaySubscriptionManager, "subscribeMany">;
