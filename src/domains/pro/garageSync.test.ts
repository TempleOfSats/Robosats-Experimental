import { describe, expect, it, vi } from "vitest";
import { hexToBase91 } from "@/lib/hexToBase91";
import { getPublicKey } from "nostr-tools/pure";
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
    expect(() => validateGarageSyncRecord({ ...robotRecord(), token: deriveGarageRobotToken(secret, robotId) }))
      .toThrow("unknown fields");
    expect(() => validateGarageSyncRecord({ ...robotRecord(), source: "imported" }))
      .toThrow("unknown fields");
  });

  it("publishes finished trades under an independent encrypted history identity", () => {
    const entry = tradeHistoryEntryFromOrder({
      slotId: hexToBase91("b".repeat(64)),
      robotName: "Robot",
      robotHashId: "hash",
      coordinatorShortAlias: "lake",
      order: completedOrder(),
      settlementInvoice: "lnbc1000n1buyerinvoice0123456789",
      settlementInvoicePurpose: "payout-received",
      observedAt: 10_000
    }, deviceId)!;
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
    const querySync = vi.fn(async (_relays, filter: { authors?: string[]; until?: number }) => {
      if (!filter.authors?.includes(event.pubkey)) return [];
      return filter.until === undefined ? Array.from({ length: 400 }, () => event) : [];
    });
    const records = await queryGarageRecords({ querySync } as unknown as SimplePool, secret, ["wss://relay.example"]);

    expect(records).toHaveLength(1);
    expect(querySync).toHaveBeenCalledTimes(2);
    expect(querySync.mock.calls[0]?.[1].authors).toHaveLength(3);
    expect(querySync.mock.calls.map((call) => call[1])).toContainEqual(expect.objectContaining({ until: 9 }));
  });

  it("materializes the first relay before slower recovery relays finish", async () => {
    const event = buildGarageRecordEvent(secret, robotRecord(), 10);
    let releaseSlowRelay!: (events: typeof event[]) => void;
    const slowRelay = new Promise<typeof event[]>((resolve) => {
      releaseSlowRelay = resolve;
    });
    const querySync = vi.fn(async (relays: string[]) => {
      if (relays[0]?.includes("slow")) return slowRelay;
      return [event];
    });
    const onFirstNonempty = vi.fn();
    const progress: number[] = [];
    const recovery = queryGarageRecordsDetailed(
      { querySync } as unknown as SimplePool,
      secret,
      ["wss://fast.example", "wss://slow.example"],
      8_000,
      onFirstNonempty,
      (state) => progress.push(state.pending)
    );
    let finished = false;
    void recovery.then(() => { finished = true; });

    await vi.waitFor(() => expect(onFirstNonempty).toHaveBeenCalledTimes(1));
    expect(finished).toBe(false);

    releaseSlowRelay([]);
    const result = await recovery;
    expect(result.records).toHaveLength(1);
    expect(result.reachableRelays).toHaveLength(2);
    expect(progress).toContain(1);
    expect(progress.at(-1)).toBe(0);
  });

  it("reports unavailable relays separately from reachable empty relays", async () => {
    const querySync = vi.fn(async () => []);
    const result = await queryGarageRecordsDetailed(
      {
        querySync,
        listConnectionStatus: () => new Map([
          ["wss://online.example/", true],
          ["wss://offline.example/", false]
        ])
      } as unknown as SimplePool,
      secret,
      ["wss://online.example", "wss://offline.example"]
    );

    expect(result.records).toEqual([]);
    expect(result.reachableRelays).toEqual(["wss://online.example"]);
    expect(result.unavailableRelays).toEqual(["wss://offline.example"]);
  });

  it("retries an inconclusive recovery and does not materialize settings without the robot manifest", async () => {
    const settingsEvent = buildGarageRecordEvent(
      secret,
      preferencesToSyncRecord(createPortableSettingsManifest(deviceId, { theme: "dark" }, 1)),
      10
    );
    const robotEvent = buildGarageRecordEvent(secret, robotRecord(), 11);
    const querySync = vi.fn(async () => querySync.mock.calls.length === 1
      ? [settingsEvent]
      : [robotEvent]);
    const onFirstSnapshot = vi.fn();
    const onRecordsComplete = vi.fn();

    const snapshot = await recoverGarageSnapshotWithPool(
      { querySync } as unknown as SimplePool,
      secret,
      [coordinator("https://relay.example")],
      { onFirstSnapshot, onRecordsComplete },
      [0]
    );

    expect(querySync).toHaveBeenCalledTimes(2);
    expect(activeGarageEntries(snapshot.garage)).toHaveLength(1);
    expect(onFirstSnapshot).toHaveBeenCalledOnce();
    expect(activeGarageEntries(onFirstSnapshot.mock.calls[0]?.[0].garage)).toHaveLength(1);
    expect(onRecordsComplete).toHaveBeenCalledOnce();
    expect(onRecordsComplete.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("does not accept a settings-only partial Fleet while a relay is unavailable", async () => {
    const settingsEvent = buildGarageRecordEvent(
      secret,
      preferencesToSyncRecord(createPortableSettingsManifest(deviceId, { theme: "dark" }, 1)),
      10
    );
    const querySync = vi.fn(async (relays: string[]) =>
      relays[0]?.includes("online") ? [settingsEvent] : []
    );
    const onFirstSnapshot = vi.fn();

    await expect(recoverGarageSnapshotWithPool(
      {
        querySync,
        listConnectionStatus: () => new Map([
          ["wss://online.example/relay", true],
          ["wss://offline.example/relay", false]
        ])
      } as unknown as SimplePool,
      secret,
      [
        coordinator("https://online.example"),
        coordinator("https://offline.example")
      ],
      { onFirstSnapshot },
      [0]
    )).rejects.toThrow("Only part of this Fleet was found");

    expect(onFirstSnapshot).not.toHaveBeenCalled();
  });

  it("uses enabled coordinator relays and excludes local or disabled coordinators", () => {
    expect(garageRelayUrls([
      { shortAlias: "local", longAlias: "Local", url: "http://localhost", enabled: true, online: true, color: "", avatarUrl: "", smallAvatarUrl: "", badgeIcons: [] },
      { shortAlias: "disabled", longAlias: "Disabled", url: "https://disabled.example", enabled: false, online: true, color: "", avatarUrl: "", smallAvatarUrl: "", badgeIcons: [] },
      { shortAlias: "test", longAlias: "Test", url: "https://example.com", enabled: true, online: true, color: "", avatarUrl: "", smallAvatarUrl: "", badgeIcons: [] }
    ])).toEqual(["wss://example.com/relay/"]);
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
