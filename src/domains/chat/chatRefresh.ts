const CONNECTED_POLL_MS = 60_000;
const DISCONNECTED_POLL_MS = 8_000;
const HIDDEN_BROWSER_POLL_MS = 120_000;

export function chatPollDelayMs(
  socketConnected: boolean,
  hidden = false,
  random = Math.random
): number {
  const base = hidden ? HIDDEN_BROWSER_POLL_MS : socketConnected ? CONNECTED_POLL_MS : DISCONNECTED_POLL_MS;
  return jitter(base, 0.15, random);
}

export function chatReconnectDelayMs(attempt: number, random = Math.random): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 5);
  return jitter(Math.min(30_000, 1_500 * (2 ** exponent)), 0.15, random);
}

function jitter(base: number, ratio: number, random: () => number): number {
  return Math.round(base * (1 - ratio + random() * ratio * 2));
}
