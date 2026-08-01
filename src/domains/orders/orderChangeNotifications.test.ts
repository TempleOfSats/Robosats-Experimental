import { afterEach, describe, expect, it, vi } from "vitest";
import {
  orderChangeMatches,
  publishOrderChangeNotification,
  replayPendingOrderChangeNotifications,
  resetOrderChangeNotificationsForTests,
  subscribeOrderChangeNotifications
} from "@/domains/orders/orderChangeNotifications";
import { subscribeNativeOrderHints } from "@/domains/transport/androidBridge";
import {
  installRefreshIntentLifecycle,
  resetRefreshIntentLifecycleForTests,
  subscribeRefreshIntents
} from "@/domains/transport/refreshIntents";

afterEach(() => {
  resetOrderChangeNotificationsForTests();
  resetRefreshIntentLifecycleForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("order change notifications", () => {
  it("targets matching orders and ignores known nonmatching ids", () => {
    const nostrHint = {
      source: "nostr" as const,
      recipientPubkey: "robot",
      coordinatorPubkey: "coordinator",
      shortAlias: "lake",
      orderId: 42,
      eventId: "event",
      createdAt: 1
    };

    expect(orderChangeMatches(nostrHint, { shortAlias: "lake", orderId: 42 })).toBe(true);
    expect(orderChangeMatches(nostrHint, { shortAlias: "temple", orderId: 42 })).toBe(false);
    expect(
      orderChangeMatches(
        { source: "native", orderId: 42 },
        {
          shortAlias: "temple",
          orderId: 41
        }
      )
    ).toBe(false);
    expect(
      orderChangeMatches(
        { source: "native", shortAlias: "lake", orderId: 42 },
        {
          shortAlias: "temple",
          orderId: 42
        }
      )
    ).toBe(false);
  });

  it("keeps a native hint with no order id as a broad fallback", () => {
    expect(
      orderChangeMatches(
        { source: "native" },
        {
          shortAlias: "lake",
          orderId: 42
        }
      )
    ).toBe(true);
  });

  it("replays startup notifications once per consumer without collapsing repeated publishes", () => {
    const nativeHint = { source: "native" as const, shortAlias: "lake", orderId: 42 };
    publishOrderChangeNotification(nativeHint);
    publishOrderChangeNotification(nativeHint);
    publishOrderChangeNotification(nostrHint("event-1"));
    publishOrderChangeNotification(nostrHint("event-2"));
    const first = vi.fn(() => true);

    const stopFirst = subscribeOrderChangeNotifications(first, {
      consumerId: "startup-owner"
    });

    expect(first).toHaveBeenCalledTimes(4);
    stopFirst();
    const replacement = vi.fn(() => true);
    subscribeOrderChangeNotifications(replacement, {
      consumerId: "startup-owner"
    });
    expect(replacement).not.toHaveBeenCalled();

    const secondOwner = vi.fn(() => true);
    subscribeOrderChangeNotifications(secondOwner, {
      consumerId: "late-owner"
    });
    expect(secondOwner).toHaveBeenCalledTimes(4);
  });

  it("keeps unacknowledged work pending until the owner explicitly replays it", () => {
    let ready = false;
    const listener = vi.fn(() => ready);
    subscribeOrderChangeNotifications(listener, {
      consumerId: "pro-reconcile"
    });

    publishOrderChangeNotification(nostrHint("event"));
    expect(listener).toHaveBeenCalledOnce();

    ready = true;
    replayPendingOrderChangeNotifications("pro-reconcile");
    replayPendingOrderChangeNotifications("pro-reconcile");

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("remembers explicit replay while an acknowledgement is pending", async () => {
    let resolveDelivery!: (acknowledged: boolean) => void;
    const listener = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveDelivery = resolve;
        })
    );
    subscribeOrderChangeNotifications(listener, {
      consumerId: "pro-reconcile"
    });

    publishOrderChangeNotification(nostrHint("event"));
    replayPendingOrderChangeNotifications("pro-reconcile");
    expect(listener).toHaveBeenCalledOnce();

    resolveDelivery(false);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
  });

  it("replays to a replacement subscription after the old delivery clears", async () => {
    let resolveDelivery!: (acknowledged: boolean) => void;
    const oldListener = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveDelivery = resolve;
        })
    );
    const stopOld = subscribeOrderChangeNotifications(oldListener, {
      consumerId: "order-owner"
    });
    publishOrderChangeNotification(nostrHint("event"));
    stopOld();
    const replacement = vi.fn(() => true);
    subscribeOrderChangeNotifications(replacement, {
      consumerId: "order-owner"
    });

    resolveDelivery(false);

    await vi.waitFor(() => expect(replacement).toHaveBeenCalledOnce());
  });

  it("delivers each publish to at most one active subscription per consumer", () => {
    const first = vi.fn(() => false);
    const duplicate = vi.fn(() => false);
    subscribeOrderChangeNotifications(first, { consumerId: "order-owner" });
    subscribeOrderChangeNotifications(duplicate, {
      consumerId: "order-owner",
      replayPending: false
    });

    publishOrderChangeNotification({ source: "native", orderId: 42 });

    expect(first).toHaveBeenCalledOnce();
    expect(duplicate).not.toHaveBeenCalled();
  });

  it("expires unconsumed startup notifications", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    publishOrderChangeNotification({ source: "native", orderId: 42 });

    vi.setSystemTime(61_001);
    const listener = vi.fn(() => true);
    subscribeOrderChangeNotifications(listener, {
      consumerId: "late-owner"
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("bounds unconsumed notification history", () => {
    for (let orderId = 1; orderId <= 65; orderId += 1) {
      publishOrderChangeNotification({ source: "native", orderId });
    }
    const listener = vi.fn(() => true);

    subscribeOrderChangeNotifications(listener, {
      consumerId: "late-owner"
    });

    expect(listener).toHaveBeenCalledTimes(64);
    expect(listener).not.toHaveBeenCalledWith({ source: "native", orderId: 1 });
    expect(listener).toHaveBeenCalledWith({ source: "native", orderId: 65 });
  });

  it("delivers Tor reconnect and native notification independently", () => {
    const { documentTarget, windowTarget } = lifecycleHarness();
    const stopLifecycle = installRefreshIntentLifecycle();
    const stopNativeHints = subscribeNativeOrderHints((hint) => {
      publishOrderChangeNotification({ source: "native", ...hint });
    });
    const lifecycleListener = vi.fn();
    const hintListener = vi.fn();
    const stopLifecycleListener = subscribeRefreshIntents(lifecycleListener);
    const stopHintListener = subscribeOrderChangeNotifications(hintListener);
    const hint = new Event("robosats:native-order-hint");
    Object.defineProperty(hint, "detail", { value: { orderId: "lake/42" } });

    windowTarget.dispatchEvent(new Event("robosats:tor-reconnected"));
    windowTarget.dispatchEvent(hint);
    documentTarget.dispatchEvent(new Event("visibilitychange"));

    expect(lifecycleListener).toHaveBeenCalledOnce();
    expect(lifecycleListener).toHaveBeenCalledWith("tor-reconnected");
    expect(hintListener).toHaveBeenCalledOnce();
    expect(hintListener).toHaveBeenCalledWith({
      source: "native",
      shortAlias: "lake",
      orderId: 42
    });
    stopLifecycleListener();
    stopHintListener();
    stopNativeHints();
    stopLifecycle();
  });

  it("publishes one typed notification for one native bridge event", () => {
    const { windowTarget } = lifecycleHarness();
    const stopNativeHints = subscribeNativeOrderHints((hint) => {
      publishOrderChangeNotification({ source: "native", ...hint });
    });
    const listener = vi.fn();
    subscribeOrderChangeNotifications(listener);
    const hint = new Event("robosats:native-order-hint");
    Object.defineProperty(hint, "detail", { value: { orderId: null } });

    windowTarget.dispatchEvent(hint);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ source: "native" });
    stopNativeHints();
  });
});

function lifecycleHarness() {
  vi.useFakeTimers();
  const windowTarget = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  });
  const documentTarget = Object.assign(new EventTarget(), {
    visibilityState: "visible" as DocumentVisibilityState
  });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  return { documentTarget, windowTarget };
}

function nostrHint(eventId: string) {
  return {
    source: "nostr" as const,
    recipientPubkey: "robot",
    coordinatorPubkey: "coordinator",
    shortAlias: "lake",
    orderId: 42,
    eventId,
    createdAt: 1
  };
}
