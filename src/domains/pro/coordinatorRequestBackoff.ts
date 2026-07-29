const BACKOFF_DELAYS_MS = [120_000, 300_000, 600_000] as const;
const FAILURES_BEFORE_OPEN = 2;

type CoordinatorBackoffState = {
  consecutiveFailures: number;
  level: number;
  openUntil: number;
  halfOpen: boolean;
};

export class CoordinatorRequestBackoff {
  private readonly states = new Map<string, CoordinatorBackoffState>();

  tryAcquire(key: string, now: number, bypass = false): boolean {
    if (bypass) return true;
    const state = this.states.get(key);
    if (!state || state.openUntil === 0) return true;
    if (state.openUntil > now || state.halfOpen) return false;
    state.halfOpen = true;
    return true;
  }

  recordSuccess(key: string): void {
    this.states.delete(key);
  }

  recordFailure(key: string, now: number): void {
    const state = this.states.get(key) ?? {
      consecutiveFailures: 0,
      level: 0,
      openUntil: 0,
      halfOpen: false
    };

    // Ignore other requests from the same wave after one of them opens the
    // circuit. Only a failed half-open recovery probe increases the delay.
    if (state.openUntil > now && !state.halfOpen) return;

    if (state.halfOpen) {
      state.level = Math.min(state.level + 1, BACKOFF_DELAYS_MS.length - 1);
      state.openUntil = now + BACKOFF_DELAYS_MS[state.level];
      state.halfOpen = false;
      this.states.set(key, state);
      return;
    }

    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= FAILURES_BEFORE_OPEN) {
      state.openUntil = now + BACKOFF_DELAYS_MS[state.level];
    }
    this.states.set(key, state);
  }

  nextAttemptAt(key: string): number | undefined {
    const state = this.states.get(key);
    return state?.openUntil || undefined;
  }

  reset(): void {
    this.states.clear();
  }
}
