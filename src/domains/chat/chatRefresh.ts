export function chatPollDelayMs(socketConnected: boolean): number {
  return socketConnected ? 15_000 : 8_000;
}

export function chatReconnectDelayMs(attempt: number): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 5);
  return Math.min(30_000, 1_500 * (2 ** exponent));
}
