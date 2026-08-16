import { describe, expect, it, vi } from "vitest";
import { finalizeEvent, getPublicKey, type Event, type Filter } from "nostr-tools";
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { buildHintTargets, ORDER_CHANGE_HINT_KIND, OrderChangeHintRuntime } from "@/domains/nostr/orderChangeHints";

const NOW = 1_800_000_000_000;
const coordinatorSecret = new Uint8Array(32).fill(7);
const coordinatorPubkey = getPublicKey(coordinatorSecret);

describe("order change hints", () => {
  it("subscribes only to known active order hosts and dispatches a verified decrypted hint", () => {
    const slot = robotSlot();
    const coordinator = coordinatorSummary();
    const harness = runtimeHarness(slot, coordinator, false);

    harness.runtime.start();

    expect(harness.subscriptions).toHaveLength(1);
    expect(harness.subscriptions[0].relays).toEqual(["ws://lake.onion/relay/"]);
    expect(harness.subscriptions[0].filter).toMatchObject({
      kinds: [ORDER_CHANGE_HINT_KIND],
      authors: [coordinatorPubkey],
      "#p": [slot.nostrPubKey]
    });

    const event = orderChangedEvent(slot, 91330);
    harness.subscriptions[0].onevent?.(event);

    expect(harness.publishHint).toHaveBeenCalledOnce();
    expect(harness.publishHint).toHaveBeenCalledWith({
      source: "nostr",
      recipientPubkey: slot.nostrPubKey,
      coordinatorPubkey,
      shortAlias: "lake",
      orderId: 91330,
      eventId: event.id,
      createdAt: NOW
    });
    harness.runtime.stop();
  });

  it("publishes the same single typed hint while PRO is active", () => {
    const slot = robotSlot();
    slot.managedBy = "fleet";
    const harness = runtimeHarness(slot, coordinatorSummary(), true);
    harness.runtime.start();

    harness.subscriptions[0].onevent?.(orderChangedEvent(slot, 91330));

    expect(harness.publishHint).toHaveBeenCalledOnce();
    harness.runtime.stop();
  });

  it("rejects stale, duplicate and incorrectly addressed events", () => {
    const slot = robotSlot();
    const harness = runtimeHarness(slot, coordinatorSummary(), false);
    harness.runtime.start();

    const valid = orderChangedEvent(slot, 91330);
    harness.subscriptions[0].onevent?.(valid);
    harness.subscriptions[0].onevent?.(valid);
    harness.subscriptions[0].onevent?.(
      orderChangedEvent(slot, 91331, {
        createdAt: Math.floor(NOW / 1000) - 601
      })
    );
    harness.subscriptions[0].onevent?.(
      orderChangedEvent(slot, 91332, {
        recipientPubkey: getPublicKey(new Uint8Array(32).fill(8))
      })
    );

    expect(harness.publishHint).toHaveBeenCalledOnce();
    harness.runtime.stop();
  });

  it("does not subscribe before a robot has a relevant coordinator order", () => {
    const slot = robotSlot();
    slot.activeOrderId = undefined;
    slot.lastOrderId = undefined;
    slot.robots.lake.activeOrderId = undefined;
    slot.robots.lake.lastOrderId = undefined;

    expect(buildHintTargets([slot], [coordinatorSummary()])).toEqual([]);
  });

  it("backs off a closed relay subscription and resets after EOSE", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const harness = runtimeHarness(robotSlot(), coordinatorSummary(), false);

    try {
      harness.runtime.start();
      expect(harness.subscriptions).toHaveLength(1);

      harness.subscriptions[0].onclose?.();
      await vi.advanceTimersByTimeAsync(14_999);
      expect(harness.subscriptions).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(harness.subscriptions).toHaveLength(2);

      harness.subscriptions[1].onclose?.();
      await vi.advanceTimersByTimeAsync(44_999);
      expect(harness.subscriptions).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(harness.subscriptions).toHaveLength(3);

      harness.subscriptions[2].oneose?.();
      harness.subscriptions[2].onclose?.();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(harness.subscriptions).toHaveLength(4);
    } finally {
      harness.runtime.stop();
      vi.useRealTimers();
    }
  });

  it("cancels a pending retry while stopped and reconnects cleanly when restarted", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const harness = runtimeHarness(robotSlot(), coordinatorSummary(), false);

    try {
      harness.runtime.start();
      harness.subscriptions[0].onclose?.();
      harness.runtime.stop();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(harness.subscriptions).toHaveLength(1);

      harness.runtime.start();
      expect(harness.subscriptions).toHaveLength(2);
    } finally {
      harness.runtime.stop();
      vi.useRealTimers();
    }
  });

  it("does not republish an already-seen event after pause and resume", () => {
    const slot = robotSlot();
    const harness = runtimeHarness(slot, coordinatorSummary(), false);
    const seen = orderChangedEvent(slot, 91330);

    harness.runtime.start();
    harness.subscriptions[0].onevent?.(seen);
    harness.runtime.stop();
    harness.runtime.start();
    harness.subscriptions[1].onevent?.(seen);

    expect(harness.publishHint).toHaveBeenCalledOnce();
    harness.runtime.stop();
  });

  it("keeps healthy coordinator subscriptions while retrying one failed relay", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const slot = robotSlot();
    const secondSecret = new Uint8Array(32).fill(8);
    const secondCoordinator = {
      ...coordinatorSummary(),
      shortAlias: "temple",
      url: "http://temple.onion",
      nostrHexPubkey: getPublicKey(secondSecret)
    };
    slot.managedBy = "fleet";
    slot.robots.temple = {
      ...slot.robots.lake,
      shortAlias: "temple"
    };
    const harness = runtimeHarness(slot, [coordinatorSummary(), secondCoordinator], true);

    try {
      harness.runtime.start();
      expect(harness.subscriptions).toHaveLength(2);

      harness.subscriptions[0].onclose?.();
      await vi.advanceTimersByTimeAsync(15_000);

      expect(harness.subscriptions).toHaveLength(3);
    } finally {
      harness.runtime.stop();
      vi.useRealTimers();
    }
  });
});

function runtimeHarness(slot: RobotSlot, coordinator: CoordinatorSummary | CoordinatorSummary[], proEnabled: boolean) {
  const coordinators = Array.isArray(coordinator) ? coordinator : [coordinator];
  const subscriptions: Array<{
    relays: string[];
    filter: Filter;
    onevent?: (event: Event) => void;
    oneose?: () => void;
    onclose?: () => void;
  }> = [];
  const pool = {
    subscribeMany(
      relays: string[],
      filter: Filter,
      params: {
        onevent?: (event: Event) => void;
        oneose?: () => void;
        onclose?: () => void;
      }
    ) {
      subscriptions.push({
        relays,
        filter,
        onevent: params.onevent,
        oneose: params.oneose,
        onclose: params.onclose
      });
      return { close: vi.fn(async () => []) };
    }
  };
  const eventTarget = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  });
  const subscribe = () => () => undefined;
  const publishHint = vi.fn();
  const runtime = new OrderChangeHintRuntime({
    pool: pool as never,
    now: () => NOW,
    canConnect: () => true,
    garageState: () => ({ slots: [slot], currentToken: slot.token }),
    federationState: () => ({ coordinators }),
    proEnabled: () => proEnabled,
    subscribeGarage: subscribe,
    subscribeFederation: subscribe,
    subscribeProPreferences: subscribe,
    publishHint,
    eventTarget: eventTarget as never
  });
  return { publishHint, runtime, subscriptions, eventTarget };
}

function robotSlot(): RobotSlot {
  const identity = deriveRobotIdentity("test-robot-token-with-enough-entropy-123456789");
  return {
    ...identity,
    nickname: "HelpfulRobot123",
    activeOrderId: 91330,
    lastOrderId: 91330,
    earnedRewards: 0,
    robots: {
      lake: {
        token: identity.token,
        shortAlias: "lake",
        nostrPubKey: identity.nostrPubKey,
        tokenSHA256: identity.tokenSHA256,
        activeOrderId: 91330,
        lastOrderId: 91330
      }
    }
  };
}

function coordinatorSummary(): CoordinatorSummary {
  return {
    shortAlias: "lake",
    longAlias: "TheBigLake",
    color: "#000",
    url: "http://lake.onion",
    nostrHexPubkey: coordinatorPubkey,
    avatarUrl: "",
    smallAvatarUrl: "",
    badgeIcons: [],
    enabled: true,
    online: true
  };
}

function orderChangedEvent(
  slot: RobotSlot,
  orderId: number,
  options: { createdAt?: number; recipientPubkey?: string } = {}
): Event {
  const recipientPubkey = options.recipientPubkey ?? slot.nostrPubKey;
  const content = encrypt(
    JSON.stringify({ type: "order_changed", version: 1, order_id: orderId }),
    getConversationKey(coordinatorSecret, recipientPubkey)
  );
  return finalizeEvent(
    {
      kind: ORDER_CHANGE_HINT_KIND,
      created_at: options.createdAt ?? Math.floor(NOW / 1000),
      tags: [["p", recipientPubkey]],
      content
    },
    coordinatorSecret
  );
}
