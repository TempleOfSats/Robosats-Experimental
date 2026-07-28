import { describe, expect, it, vi } from "vitest";
import {
  getSharedRelayPool,
  RELAY_CONNECTION_TIMEOUT_MS,
  runRelayQuery,
  withRelayQueryPool
} from "@/domains/nostr/sharedRelayPool";

describe("shared Nostr relay pool", () => {
  it("keeps health checks but delegates reconnects to bounded app retry policies", () => {
    const pool = getSharedRelayPool();

    expect(pool.enablePing).toBe(true);
    expect(pool.enableReconnect).toBe(false);
    expect(pool.maxWaitForConnection).toBe(RELAY_CONNECTION_TIMEOUT_MS);
  });

  it("reuses the live pool for query traffic", async () => {
    const pool = getSharedRelayPool();

    await expect(withRelayQueryPool(async (queryPool) => queryPool)).resolves.toBe(pool);
  });

  it("serializes temporary REQs targeting the same relay", async () => {
    let releaseFirst: () => void = () => undefined;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const calls: string[] = [];
    const first = runRelayQuery("wss://relay.example", async () => {
      calls.push("first-start");
      await firstPending;
      calls.push("first-end");
      return 1;
    });
    const second = runRelayQuery("wss://relay.example", async () => {
      calls.push("second");
      return 2;
    });

    await vi.waitFor(() => expect(calls).toEqual(["first-start"]));
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(calls).toEqual(["first-start", "first-end", "second"]);
  });
});
