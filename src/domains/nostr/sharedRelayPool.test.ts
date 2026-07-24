import { describe, expect, it } from "vitest";
import { getSharedRelayPool } from "@/domains/nostr/sharedRelayPool";

describe("shared Nostr relay pool", () => {
  it("keeps ping health checks and reconnects enabled", () => {
    const pool = getSharedRelayPool();

    expect(pool.enablePing).toBe(true);
    expect(pool.enableReconnect).toBe(true);
  });
});
