import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/pure";
import type { SimplePool } from "nostr-tools/pool";
import { normalizeURL } from "nostr-tools/utils";
import { describe, expect, it, vi } from "vitest";
import { verifyGarageBackupWithPool } from "@/domains/pro/garageBackupVerification";
import { buildGarageRecordEvent } from "@/domains/pro/garageSync";
import { preferencesToSyncRecord, type GarageSyncRecord } from "@/domains/pro/garageSyncRecords";
import { createPortableSettingsManifest } from "@/domains/pro/portableSettings";

const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const deviceId = "00112233445566778899aabbccddeeff";

describe("Garage backup verification", () => {
  it("verifies only relays that can read back every current Fleet record", async () => {
    const expected: GarageSyncRecord[] = [
      {
        type: "robot",
        version: 1,
        id: "a".repeat(32),
        tokenId: "b".repeat(64),
        nickname: "Verified robot",
        revision: 1,
        writerDeviceId: deviceId,
        updatedAt: 1
      },
      preferencesToSyncRecord(createPortableSettingsManifest(deviceId, { theme: "dark" }, 1))
    ];
    const events = expected.map((record, index) => buildGarageRecordEvent(secret, record, 10 + index));
    const querySync = vi.fn(async (relays: string[]) => {
      const relay = relays[0] ?? "";
      if (relay.includes("offline")) throw new Error("offline");
      if (relay.includes("partial")) return [events[0]];
      return events;
    });
    const pool = directQueryPool(querySync);

    await expect(
      verifyGarageBackupWithPool(pool, secret, expected, [
        "wss://full-one.example",
        "wss://full-two.example",
        "wss://partial.example"
      ])
    ).resolves.toMatchObject({
      reachableRelays: 3,
      requiredRelays: 2,
      totalRelays: 3,
      verified: true,
      verifiedRelays: 2
    });
    await expect(
      verifyGarageBackupWithPool(pool, secret, expected, [
        "wss://full-one.example",
        "wss://partial.example",
        "wss://offline.example"
      ])
    ).resolves.toMatchObject({
      reachableRelays: 2,
      requiredRelays: 2,
      totalRelays: 3,
      verified: false,
      verifiedRelays: 1
    });
  });

  it("does not verify records received before the relay closes without EOSE", async () => {
    const expected: GarageSyncRecord[] = [
      preferencesToSyncRecord(createPortableSettingsManifest(deviceId, { theme: "dark" }, 1))
    ];
    const event = buildGarageRecordEvent(secret, expected[0], 10);
    const pool = {
      ensureRelay: async () => ({
        subscribe: (
          _filters: Filter[],
          params: { onclose?: (reason: string) => void; onevent?: (event: Event) => void }
        ) => {
          queueMicrotask(() => {
            params.onevent?.(event);
            params.onclose?.("relay closed before EOSE");
          });
          return { close: () => undefined };
        }
      }),
      listConnectionStatus: () => new Map([[normalizeURL("wss://closed.example"), true]])
    } as unknown as SimplePool;

    await expect(verifyGarageBackupWithPool(pool, secret, expected, ["wss://closed.example"])).resolves.toMatchObject({
      reachableRelays: 1,
      verified: false,
      verifiedRelays: 0
    });
  });
});

function directQueryPool(querySync: (relays: string[]) => Promise<Event[]>): SimplePool {
  const statuses = new Map<string, boolean>();
  return {
    ensureRelay: async (relay: string) => ({
      subscribe: (
        _filters: Filter[],
        params: {
          onclose?: (reason: string) => void;
          oneose?: () => void;
          onevent?: (event: Event) => void;
        }
      ) => {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          params.onclose?.("closed by test query");
        };
        void querySync([relay]).then(
          (events) => {
            if (closed) return;
            statuses.set(normalizeURL(relay), true);
            events.forEach((event) => params.onevent?.(event));
            params.oneose?.();
          },
          () => {
            if (closed) return;
            closed = true;
            statuses.set(normalizeURL(relay), false);
            params.onclose?.("relay query failed");
          }
        );
        return { close };
      }
    }),
    listConnectionStatus: () => statuses
  } as unknown as SimplePool;
}
