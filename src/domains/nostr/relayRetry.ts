export const RELAY_RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

const RETRY_JITTER_RATIO = 0.2;

export function relayRetryDelay(attempt: number, random = Math.random): number {
  const base = RELAY_RETRY_DELAYS_MS[Math.min(
    Math.max(0, attempt),
    RELAY_RETRY_DELAYS_MS.length - 1
  )];
  const jitter = Math.round(base * RETRY_JITTER_RATIO * Math.max(0, Math.min(1, random())));
  return base + jitter;
}
