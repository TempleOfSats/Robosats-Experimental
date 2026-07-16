export const PUBLIC_DURATION_MIN_SECONDS = 10 * 60;
export const PUBLIC_DURATION_MAX_SECONDS = 23 * 60 * 60 + 59 * 60;

export const ESCROW_DURATION_MIN_SECONDS = 60 * 60;
export const ESCROW_DURATION_MAX_SECONDS = 8 * 60 * 60;

export function durationIsInRange(value: number, minSeconds: number, maxSeconds: number): boolean {
  return Number.isFinite(value) && value >= minSeconds && value <= maxSeconds;
}
