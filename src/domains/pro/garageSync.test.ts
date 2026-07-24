import { describe, expect, it, vi } from "vitest";
import { getPublicKey } from "nostr-tools/pure";
import type { SimplePool } from "nostr-tools/pool";
import {
  buildGarageRecordEvent,
  decodeGarageRecordEvent,
  garageRelayUrls,
  queryGarageRecords
} from "@/domains/pro/garageSync";
import { deriveGarageDomainKey } from "@/domains/pro/garageCrypto";
import { deriveGarageRobotToken, garageTokenId } from "@/domains/pro/garageVault";
import { syncRecordAddress, validateGarageSyncRecord, type GarageRobotRecord } from "@/domains/pro/garageSyncRecords";

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

  it("paginates full relay pages without losing the decoded record", async () => {
    const event = buildGarageRecordEvent(secret, robotRecord(), 10);
    const querySync = vi.fn(async (_relays, filter: { authors?: string[]; until?: number }) => {
      if (!filter.authors?.includes(event.pubkey)) return [];
      return filter.until === undefined ? Array.from({ length: 400 }, () => event) : [];
    });
    const records = await queryGarageRecords({ querySync } as unknown as SimplePool, secret, ["wss://relay.example"]);

    expect(records).toHaveLength(1);
    expect(querySync).toHaveBeenCalledTimes(2);
    expect(querySync.mock.calls[0]?.[1].authors).toHaveLength(2);
    expect(querySync.mock.calls.map((call) => call[1])).toContainEqual(expect.objectContaining({ until: 9 }));
  });

  it("uses enabled coordinator relays and excludes local or disabled coordinators", () => {
    expect(garageRelayUrls([
      { shortAlias: "local", longAlias: "Local", url: "http://localhost", enabled: true, online: true, color: "", avatarUrl: "", smallAvatarUrl: "", badgeIcons: [] },
      { shortAlias: "disabled", longAlias: "Disabled", url: "https://disabled.example", enabled: false, online: true, color: "", avatarUrl: "", smallAvatarUrl: "", badgeIcons: [] },
      { shortAlias: "test", longAlias: "Test", url: "https://example.com", enabled: true, online: true, color: "", avatarUrl: "", smallAvatarUrl: "", badgeIcons: [] }
    ])).toEqual(["wss://example.com/relay/"]);
  });
});
