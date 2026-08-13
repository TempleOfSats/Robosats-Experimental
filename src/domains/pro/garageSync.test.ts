import { describe, expect, it, vi } from "vitest";
import { hexToBase91 } from "@/lib/hexToBase91";
import type { Filter } from "nostr-tools/filter";
import { getPublicKey, type Event } from "nostr-tools/pure";
import type { SimplePool } from "nostr-tools/pool";
import {
  buildGarageRecordEvent,
  decodeGarageRecordEvent,
  garageRelayUrls,
  queryGarageRecords,
  queryGarageRecordsDetailed,
  recoverGarageSnapshotWithPool
} from "@/domains/pro/garageSync";
import { deriveGarageDomainKey } from "@/domains/pro/garageCrypto";
import { activeGarageEntries, deriveGarageRobotToken, garageTokenId } from "@/domains/pro/garageVault";
import {
  preferencesToSyncRecord,
  syncRecordAddress,
  tradeHistoryToSyncRecord,
  validateGarageSyncRecord,
  type GarageRobotRecord
} from "@/domains/pro/garageSyncRecords";
import { createPortableSettingsManifest } from "@/domains/pro/portableSettings";
import { tradeHistoryEntryFromOrder } from "@/domains/pro/tradeHistory";
import type { OrderDto } from "@/domains/orders/order.types";

const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const deviceId = "00112233445566778899aabbccddeeff";
const secondDeviceId = "ffeeddccbbaa99887766554433221100";
const robotId = "a".repeat(32);

type TestRelayPage = {
  end?: "close" | "eose" | "pending";
  events: Event[];
};

function relayQueryPool(
  queryPage: (relays: string[], filter: Filter) => Event[] | TestRelayPage | Promise<Event[] | TestRelayPage>,
  listConnectionStatus?: () => Map<string, boolean>
): {
  pool: SimplePool;
  queryPage: ReturnType<typeof vi.fn>;
  subscriptions: Array<{ close: ReturnType<typeof vi.fn>; eoseTimeout: number | undefined; relay: string }>;
} {
  const queryPageMock = vi.fn(queryPage);
  const subscriptions: Array<{
    close: ReturnType<typeof vi.fn>;
    eoseTimeout: number | undefined;
    relay: string;
  }> = [];
  const ensureRelay = vi.fn(async (relay: string) => ({
    subscribe: (
      filters: Filter[],
      params: {
        eoseTimeout?: number;
        onclose?: (reason: string) => void;
        oneose?: () => void;
        onevent?: (event: Event) => void;
      }
    ) => {
      let closed = false;
      const close = vi.fn((reason = "closed by test") => {
        if (closed) return;
        closed = true;
        params.onclose?.(reason);
      });
      subscriptions.push({ close, eoseTimeout: params.eoseTimeout, relay });
      void Promise.resolve(queryPageMock([relay], filters[0])).then(
        (value) => {
          if (closed) return;
          const page: TestRelayPage = Array.isArray(value) ? { end: "eose", events: value } : value;
          page.events.forEach((event) => params.onevent?.(event));
          if (page.end === "close") {
            closed = true;
            params.onclose?.("relay closed");
          } else if (page.end !== "pending") {
            params.oneose?.();
          }
        },
        () => {
          if (closed) return;
          closed = true;
          params.onclose?.("relay failed");
        }
      );
      return { close };
    }
  }));
  return {
    pool: { ensureRelay, ...(listConnectionStatus ? { listConnectionStatus } : {}) } as unknown as SimplePool,
    queryPage: queryPageMock,
    subscriptions
  };
}

function robotRecord(): GarageRobotRecord {
  const token = deriveGarageRobotToken(secret, robotId);
  return {
    type: "robot",
    version: 1,
    id: robotId,
    tokenId: garageTokenId(token),
    nickname: "Derived",
    revision: 1,
    writerDeviceId: deviceId,
    updatedAt: 1
  };
}

describe("Garage NIP-78 records", () => {
  it("publishes one opaque encrypted record without a derived token", () => {
    const record = robotRecord();
    const event = buildGarageRecordEvent(secret, record, 10);
    expect(event.kind).toBe(30078);
    expect(event.pubkey).toBe(getPublicKey(deriveGarageDomainKey(secret, "garage-sync")));
    expect(event.tags).toEqual([["d", syncRecordAddress(secret, record)]]);
    expect(event.content).not.toContain(record.nickname);
    expect(decodeGarageRecordEvent(event, secret)?.record).toEqual(record);
  });

  it("rejects a record moved to another opaque address", () => {
    const event = buildGarageRecordEvent(secret, robotRecord(), 10);
    const damaged = { ...event, tags: [["d", "0".repeat(64)]] };
    expect(decodeGarageRecordEvent(damaged, secret)).toBeUndefined();
  });

  it("uses distinct deterministic addresses for active and tombstone records", () => {
    const active = robotRecord();
    const tombstone = {
      type: "robot-tombstone" as const,
      version: 1 as const,
      id: active.id,
      tokenId: active.tokenId,
      revision: 2,
      writerDeviceId: active.writerDeviceId,
      updatedAt: 2
    };
    expect(syncRecordAddress(secret, active)).toBe(syncRecordAddress(secret, active));
    expect(syncRecordAddress(secret, active)).not.toBe(syncRecordAddress(secret, tombstone));
  });

  it("keeps concurrent writers at distinct relay addresses", () => {
    const first = robotRecord();
    const second = { ...first, writerDeviceId: secondDeviceId };

    expect(syncRecordAddress(secret, first)).not.toBe(syncRecordAddress(secret, second));
  });

  it("rejects prototype records containing raw robot material", () => {
    expect(() =>
      validateGarageSyncRecord({ ...robotRecord(), token: deriveGarageRobotToken(secret, robotId) })
    ).toThrow("unknown fields");
    expect(() => validateGarageSyncRecord({ ...robotRecord(), source: "imported" })).toThrow("unknown fields");
  });

  it("publishes finished trades under an independent encrypted history identity", () => {
    const entry = tradeHistoryEntryFromOrder(
      {
        slotId: hexToBase91("b".repeat(64)),
        robotName: "Robot",
        robotHashId: "hash",
        coordinatorShortAlias: "lake",
        order: completedOrder(),
        settlementInvoice: "lnbc1000n1buyerinvoice0123456789",
        settlementInvoicePurpose: "payout-received",
        observedAt: 10_000
      },
      deviceId
    )!;
    const record = tradeHistoryToSyncRecord(entry);
    const event = buildGarageRecordEvent(secret, record, 10);

    expect(event.pubkey).toBe(getPublicKey(deriveGarageDomainKey(secret, "history-sync")));
    expect(event.content).not.toContain("Robot");
    expect(event.content).not.toContain("lnbc1000n1buyerinvoice");
    expect(JSON.stringify(event.tags)).not.toContain("lnbc1000n1buyerinvoice");
    expect(decodeGarageRecordEvent(event, secret)?.record).toEqual(record);
  });

  it("paginates full relay pages without losing the decoded record", async () => {
    const event = buildGarageRecordEvent(secret, robotRecord(), 10);
    const relayPool = relayQueryPool(async (_relays, filter) => {
      if (!filter.authors?.includes(event.pubkey)) return [];
      return filter.until === undefined ? Array.from({ length: 400 }, () => event) : [];
    });
    const records = await queryGarageRecords(relayPool.pool, secret, ["wss://relay.example"]);

    expect(records).toHaveLength(1);
    expect(relayPool.queryPage).toHaveBeenCalledTimes(2);
    expect(relayPool.queryPage.mock.calls[0]?.[1].authors).toHaveLength(3);
    expect(relayPool.queryPage.mock.calls.map((call) => call[1])).toContainEqual(expect.objectContaining({ until: 9 }));
  });

  it("bounds events retained from a nonconforming relay page", async () => {
    const oldest = buildGarageRecordEvent(secret, robotRecord(), 10);
    const ignoredOverflow = buildGarageRecordEvent(secret, robotRecord(), 1);
    const relayPool = relayQueryPool(async (_relays, filter) => {
      if (filter.until !== undefined) return [];
      return [...Array.from({ length: 400 }, () => oldest), ignoredOverflow];
    });

    await queryGarageRecords(relayPool.pool, secret, ["wss://relay.example"]);

    expect(relayPool.queryPage).toHaveBeenCalledTimes(2);
    expect(relayPool.queryPage.mock.calls[1]?.[1].until).toBe(9);
  });

  it("does not treat the app deadline as relay EOSE or continue pagination", async () => {
    vi.useFakeTimers();
    try {
      const event = buildGarageRecordEvent(secret, robotRecord(), 10);
      const relayPool = relayQueryPool(() => ({
        end: "pending",
        events: Array.from({ length: 400 }, () => event)
      }));

      const query = queryGarageRecords(relayPool.pool, secret, ["wss://relay.example"], 50);
      await vi.advanceTimersByTimeAsync(50);

      await expect(query).resolves.toHaveLength(1);
      expect(relayPool.queryPage).toHaveBeenCalledOnce();
      expect(relayPool.subscriptions[0]?.eoseTimeout).toBeGreaterThan(50);
      expect(relayPool.subscriptions[0]?.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the recovery deadline while its relay query is queued", async () => {
    vi.useFakeTimers();
    try {
      const relay = "wss://relay.example/relay/";
      const relayPool = relayQueryPool(() => ({ end: "pending", events: [] }));
      const blockingQuery = queryGarageRecords(relayPool.pool, secret, [relay], 30_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(relayPool.queryPage).toHaveBeenCalledOnce();

      const recovery = recoverGarageSnapshotWithPool(
        relayPool.pool,
        secret,
        [coordinator("https://relay.example")]
      );
      const outcome = recovery.then(
        () => undefined,
        (error: unknown) => error
      );

      await vi.advanceTimersByTimeAsync(20_000);

      await expect(outcome).resolves.toEqual(
        expect.objectContaining({ message: expect.stringContaining("No coordinator relay finished") })
      );
      expect(relayPool.queryPage).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(10_000);
      await expect(blockingQuery).resolves.toEqual([]);
      await vi.advanceTimersByTimeAsync(0);
      expect(relayPool.queryPage).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not treat a relay close as EOSE or close its subscription twice", async () => {
    const event = buildGarageRecordEvent(secret, robotRecord(), 10);
    const relayPool = relayQueryPool(() => ({
      end: "close",
      events: Array.from({ length: 400 }, () => event)
    }));

    await expect(queryGarageRecords(relayPool.pool, secret, ["wss://relay.example"])).resolves.toHaveLength(1);

    expect(relayPool.queryPage).toHaveBeenCalledOnce();
    expect(relayPool.subscriptions[0]?.close).not.toHaveBeenCalled();
  });

  it("reports progress before a slower recovery relay finishes", async () => {
    const event = buildGarageRecordEvent(secret, robotRecord(), 10);
    let releaseSlowRelay!: (events: (typeof event)[]) => void;
    const slowRelay = new Promise<(typeof event)[]>((resolve) => {
      releaseSlowRelay = resolve;
    });
    const relayPool = relayQueryPool(async (relays) => {
      if (relays[0]?.includes("slow")) return slowRelay;
      return [event];
    });
    const progress: number[] = [];
    const recovery = queryGarageRecordsDetailed(
      relayPool.pool,
      secret,
      ["wss://fast.example", "wss://slow.example"],
      8_000,
      (state) => progress.push(state.pending)
    );
    let finished = false;
    void recovery.then(() => {
      finished = true;
    });

    await vi.waitFor(() => expect(progress).toContain(1));
    expect(finished).toBe(false);

    releaseSlowRelay([]);
    const result = await recovery;
    expect(result.records).toHaveLength(1);
    expect(result.reachableRelays).toHaveLength(2);
    expect(progress).toContain(1);
    expect(progress.at(-1)).toBe(0);
  });

  it("restores after a short grace period without waiting for a stalled relay", async () => {
    vi.useFakeTimers();
    try {
      const event = buildGarageRecordEvent(secret, robotRecord(), 10);
      const relayPool = relayQueryPool((relays) =>
        relays[0]?.includes("slow") ? { end: "pending", events: [] } : [event]
      );
      let finished = false;
      const recovery = recoverGarageSnapshotWithPool(
        relayPool.pool,
        secret,
        [coordinator("https://fast.example"), coordinator("https://slow.example")]
      );
      void recovery.then(() => {
        finished = true;
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_499);
      expect(finished).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(recovery).resolves.toEqual(
        expect.objectContaining({
          coverage: {
            reconciledRelays: ["wss://fast.example/relay/"],
            targetRelays: ["wss://fast.example/relay/", "wss://slow.example/relay/"]
          },
          snapshot: expect.objectContaining({ format: "robosats-exp-garage-snapshot" })
        })
      );
      expect(relayPool.subscriptions.find(({ relay }) => relay.includes("slow"))?.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("merges another relay that completes inside the recovery grace period", async () => {
    vi.useFakeTimers();
    try {
      const robotEvent = buildGarageRecordEvent(secret, robotRecord(), 10);
      const settingsEvent = buildGarageRecordEvent(
        secret,
        preferencesToSyncRecord(createPortableSettingsManifest(deviceId, { theme: "dark" }, 1)),
        11
      );
      const relayPool = relayQueryPool(
        (relays) =>
          new Promise<Event[]>((resolve) => {
            const slow = relays[0]?.includes("settings");
            globalThis.setTimeout(() => resolve(slow ? [settingsEvent] : [robotEvent]), slow ? 500 : 0);
          })
      );
      const recovery = recoverGarageSnapshotWithPool(
        relayPool.pool,
        secret,
        [coordinator("https://robot.example"), coordinator("https://settings.example")]
      );

      await vi.advanceTimersByTimeAsync(500);

      const result = await recovery;
      expect(result.snapshot.settings.theme.value).toBe("dark");
      expect(result.coverage.reconciledRelays).toEqual([
        "wss://robot.example/relay/",
        "wss://settings.example/relay/"
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports unavailable relays separately from reachable empty relays", async () => {
    const relayPool = relayQueryPool(
      async () => [],
      () =>
        new Map([
          ["wss://online.example/", true],
          ["wss://offline.example/", false]
        ])
    );
    const result = await queryGarageRecordsDetailed(relayPool.pool, secret, [
      "wss://online.example",
      "wss://offline.example"
    ]);

    expect(result.records).toEqual([]);
    expect(result.reachableRelays).toEqual(["wss://online.example"]);
    expect(result.unavailableRelays).toEqual(["wss://offline.example"]);
  });

  it("does not materialize settings without the robot manifest", async () => {
    const settingsEvent = buildGarageRecordEvent(
      secret,
      preferencesToSyncRecord(createPortableSettingsManifest(deviceId, { theme: "dark" }, 1)),
      10
    );
    const relayPool = relayQueryPool(async () => [settingsEvent]);

    await expect(
      recoverGarageSnapshotWithPool(relayPool.pool, secret, [coordinator("https://relay.example")])
    ).rejects.toThrow("No Fleet was found");

    expect(relayPool.queryPage).toHaveBeenCalledOnce();
  });

  it("does not repeat an inconclusive relay search unless the caller retries", async () => {
    const relayPool = relayQueryPool(() => []);

    await expect(
      recoverGarageSnapshotWithPool(
        relayPool.pool,
        secret,
        [coordinator("https://relay.example")]
      )
    ).rejects.toThrow("No Fleet was found");

    expect(relayPool.queryPage).toHaveBeenCalledOnce();
  });

  it("does not materialize a robot received before the recovery deadline without relay EOSE", async () => {
    vi.useFakeTimers();
    try {
      const robotEvent = buildGarageRecordEvent(secret, robotRecord(), 11);
      const relayPool = relayQueryPool(() => ({ end: "pending", events: [robotEvent] }));
      const recovery = recoverGarageSnapshotWithPool(
        relayPool.pool,
        secret,
        [coordinator("https://relay.example")]
      );
      const outcome = recovery.then(
        () => undefined,
        (error: unknown) => error
      );

      await vi.advanceTimersByTimeAsync(20_000);

      await expect(outcome).resolves.toEqual(
        expect.objectContaining({ message: expect.stringContaining("No coordinator relay finished") })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not materialize a robot received before relay closure without EOSE", async () => {
    const robotEvent = buildGarageRecordEvent(secret, robotRecord(), 11);
    const relayPool = relayQueryPool(() => ({ end: "close", events: [robotEvent] }));
    await expect(
      recoverGarageSnapshotWithPool(relayPool.pool, secret, [coordinator("https://relay.example")])
    ).rejects.toThrow("No coordinator relay finished");
  });

  it("does not combine an empty completed relay with a robot from an incomplete relay", async () => {
    const robotEvent = buildGarageRecordEvent(secret, robotRecord(), 11);
    const relayPool = relayQueryPool((relays) =>
      relays[0]?.includes("partial")
        ? { end: "close", events: [robotEvent] }
        : { end: "eose", events: [] }
    );
    await expect(
      recoverGarageSnapshotWithPool(
        relayPool.pool,
        secret,
        [coordinator("https://complete.example"), coordinator("https://partial.example")]
      )
    ).rejects.toThrow("Only part of this Fleet was received");
  });

  it("materializes recovery after the relay sends EOSE", async () => {
    const robotEvent = buildGarageRecordEvent(secret, robotRecord(), 11);
    const relayPool = relayQueryPool(() => ({ end: "eose", events: [robotEvent] }));
    const result = await recoverGarageSnapshotWithPool(
      relayPool.pool,
      secret,
      [coordinator("https://relay.example")]
    );

    expect(activeGarageEntries(result.snapshot.garage)).toHaveLength(1);
    expect(result.coverage.reconciledRelays).toEqual(["wss://relay.example/relay/"]);
  });

  it("does not accept a settings-only partial Fleet while a relay is unavailable", async () => {
    const settingsEvent = buildGarageRecordEvent(
      secret,
      preferencesToSyncRecord(createPortableSettingsManifest(deviceId, { theme: "dark" }, 1)),
      10
    );
    const relayPool = relayQueryPool(
      async (relays) => (relays[0]?.includes("online") ? [settingsEvent] : []),
      () =>
        new Map([
          ["wss://online.example/relay", true],
          ["wss://offline.example/relay", false]
        ])
    );
    await expect(
      recoverGarageSnapshotWithPool(
        relayPool.pool,
        secret,
        [coordinator("https://online.example"), coordinator("https://offline.example")]
      )
    ).rejects.toThrow("Only part of this Fleet was found");
  });

  it("uses enabled coordinator relays and excludes local or disabled coordinators", () => {
    expect(
      garageRelayUrls([
        {
          shortAlias: "local",
          longAlias: "Local",
          url: "http://localhost",
          enabled: true,
          online: true,
          color: "",
          avatarUrl: "",
          smallAvatarUrl: "",
          badgeIcons: []
        },
        {
          shortAlias: "disabled",
          longAlias: "Disabled",
          url: "https://disabled.example",
          enabled: false,
          online: true,
          color: "",
          avatarUrl: "",
          smallAvatarUrl: "",
          badgeIcons: []
        },
        {
          shortAlias: "test",
          longAlias: "Test",
          url: "https://example.com",
          enabled: true,
          online: true,
          color: "",
          avatarUrl: "",
          smallAvatarUrl: "",
          badgeIcons: []
        }
      ])
    ).toEqual(["wss://example.com/relay/"]);
  });
});

function coordinator(url: string) {
  return {
    shortAlias: "test",
    longAlias: "Test",
    url,
    enabled: true,
    online: true,
    color: "",
    avatarUrl: "",
    smallAvatarUrl: "",
    badgeIcons: []
  };
}

function completedOrder(): OrderDto {
  return {
    id: 42,
    status: 14,
    type: 0,
    amount: 100,
    currency: 1,
    payment_method: "SEPA",
    premium: 0,
    satoshis: 1_000,
    is_maker: false,
    is_taker: true,
    is_buyer: true,
    is_seller: false,
    maker_nick: "Maker",
    maker_hash_id: "maker",
    taker_nick: "Taker",
    taker_hash_id: "taker",
    bond_invoice: "",
    bond_satoshis: 0,
    escrow_invoice: "",
    escrow_satoshis: 0,
    invoice_amount: 0,
    swap_allowed: false,
    suggested_mining_fee_rate: 0,
    swap_fee_rate: 0,
    expires_at: "2026-07-23T12:00:00Z",
    shortAlias: "lake"
  };
}
