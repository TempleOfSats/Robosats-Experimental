import { describe, expect, it } from "vitest";
import { hasNewFleetOutboxRevision } from "@/domains/pro/proRuntime";
import type { GarageOutboxItem } from "@/domains/pro/garageSyncRecords";

describe("Pro Fleet sync scheduling", () => {
  it("schedules new records and new revisions", () => {
    const previous = [outboxItem("garage-sync:robot:one", 1)];

    expect(
      hasNewFleetOutboxRevision([...previous, outboxItem("settings-sync:preferences:preferences", 1)], previous)
    ).toBe(true);
    expect(hasNewFleetOutboxRevision([outboxItem("garage-sync:robot:one", 2)], previous)).toBe(true);
  });

  it("does not reschedule acknowledgement, removal, or ordering changes", () => {
    const first = outboxItem("garage-sync:robot:one", 1);
    const second = outboxItem("history-sync:trade-history:two", 1);
    const previous = [first, second];

    expect(
      hasNewFleetOutboxRevision([{ ...first, acceptedRelays: ["wss://relay.example/relay/"] }, second], previous)
    ).toBe(false);
    expect(hasNewFleetOutboxRevision([second], previous)).toBe(false);
    expect(hasNewFleetOutboxRevision([second, first], previous)).toBe(false);
  });
});

function outboxItem(key: string, revision: number): GarageOutboxItem {
  return {
    key,
    revision,
    queuedAt: 1,
    attempts: 0,
    nextAttemptAt: 1,
    acceptedRelays: []
  };
}
