import { describe, expect, it } from "vitest";
import {
  getSharedRelayPool,
  RELAY_CONNECTION_TIMEOUT_MS,
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
});
