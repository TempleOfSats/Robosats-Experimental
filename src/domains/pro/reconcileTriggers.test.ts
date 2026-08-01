import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  publishCoordinatorOrderActionActivity,
  resetCoordinatorOrderActivityForTests
} from "@/domains/orders/orderActivity";
import {
  publishOrderChangeNotification,
  replayPendingOrderChangeNotifications,
  resetOrderChangeNotificationsForTests
} from "@/domains/orders/orderChangeNotifications";
import type { GarageReconcileController } from "@/domains/pro/garageReconciler";
import {
  PRO_ORDER_CHANGE_CONSUMER_ID,
  registerExpiryReconcileTrigger,
  registerReconcileTriggers
} from "@/domains/pro/reconcileTriggers";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import {
  publishRefreshIntent,
  resetRefreshIntentLifecycleForTests,
  type RefreshReason
} from "@/domains/transport/refreshIntents";

const markProOrderActionFinishedMock = vi.hoisted(() => vi.fn());
const markProOrderActionStartedMock = vi.hoisted(() => vi.fn());

vi.mock("@/domains/pro/garageReconciler", () => ({
  markProOrderActionFinished: markProOrderActionFinishedMock,
  markProOrderActionStarted: markProOrderActionStartedMock
}));

let windowTarget: EventTarget & Pick<typeof globalThis, "setTimeout" | "clearTimeout" | "setInterval" | "clearInterval">;
let documentTarget: EventTarget & { visibilityState: DocumentVisibilityState };

beforeEach(() => {
  vi.useFakeTimers();
  markProOrderActionFinishedMock.mockReset();
  markProOrderActionStartedMock.mockReset();
  windowTarget = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval
  });
  documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  resetCoordinatorOrderActivityForTests();
  resetOrderChangeNotificationsForTests();
  resetRefreshIntentLifecycleForTests();
  useProTradeIndexStore.getState().resetRuntimeCache();
});

afterEach(() => {
  resetOrderChangeNotificationsForTests();
  resetRefreshIntentLifecycleForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reconciliation triggers", () => {
  it("keeps recurring all-robot work disabled in standard mode", async () => {
    const controller = fakeController();
    const reconcileCurrent = vi.fn(async () => undefined);
    const cleanup = registerReconcileTriggers({
      controller,
      proEnabled: () => false,
      reconcileCurrent,
      intervalMs: 100,
      debounceMs: 10
    });

    await vi.advanceTimersByTimeAsync(250);
    expect(controller.reconcileAll).not.toHaveBeenCalled();
    expect(reconcileCurrent).not.toHaveBeenCalled();

    dispatchLifecycle("focus");
    await vi.advanceTimersByTimeAsync(10);
    expect(reconcileCurrent).toHaveBeenCalledWith("window-focus");
    cleanup();
  });

  it("runs all-robot refresh only while PRO is enabled and visible", async () => {
    const controller = fakeController();
    const cleanup = registerReconcileTriggers({
      controller,
      proEnabled: () => true,
      reconcileCurrent: vi.fn(async () => undefined),
      intervalMs: 100
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(controller.reconcileAll).toHaveBeenCalledWith("interval");

    documentTarget.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(100);
    expect(controller.reconcileAll).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("invalidates old requests before reconciling a restored Tor connection", () => {
    const controller = fakeController();
    const cleanup = registerReconcileTriggers({
      controller,
      proEnabled: () => true,
      reconcileCurrent: vi.fn(async () => undefined)
    });

    dispatchLifecycle("tor-reconnected");
    expect(controller.invalidateEpoch).toHaveBeenCalledOnce();
    expect(controller.reconcileAll).toHaveBeenCalledWith("tor-reconnected");
    cleanup();
  });

  it("reconciles after a native application resume", async () => {
    const controller = fakeController();
    const cleanup = registerReconcileTriggers({
      controller,
      proEnabled: () => true,
      reconcileCurrent: vi.fn(async () => undefined),
      debounceMs: 10
    });

    dispatchLifecycle("resume");
    await vi.advanceTimersByTimeAsync(10);

    expect(controller.reconcileAll).toHaveBeenCalledWith("visibility-resume");
    cleanup();
  });

  it("routes typed order hints only to the active Pro owner", () => {
    const standardController = fakeController();
    const stopStandard = registerReconcileTriggers({
      controller: standardController,
      proEnabled: () => false,
      reconcileCurrent: vi.fn(async () => undefined)
    });
    stopStandard();
    const proController = fakeController();
    const stopPro = registerReconcileTriggers({
      controller: proController,
      proEnabled: () => true,
      reconcileCurrent: vi.fn(async () => undefined)
    });
    const hint = nostrHint(42);

    publishOrderChangeNotification(hint);
    const nativeHint = { source: "native" as const, shortAlias: "lake", orderId: 42 };
    publishOrderChangeNotification(nativeHint);
    publishOrderChangeNotification({ source: "native" });

    expect(standardController.handleOrderHint).not.toHaveBeenCalled();
    expect(standardController.handleNativeOrderHint).not.toHaveBeenCalled();
    expect(proController.handleOrderHint).toHaveBeenCalledOnce();
    expect(proController.handleOrderHint).toHaveBeenCalledWith(hint);
    expect(proController.handleNativeOrderHint).toHaveBeenNthCalledWith(1, nativeHint);
    expect(proController.handleNativeOrderHint).toHaveBeenNthCalledWith(2, { source: "native" });
    stopPro();
  });

  it("replays a hint published before the Pro owner registers", () => {
    const hint = nostrHint(42);
    publishOrderChangeNotification(hint);
    const controller = fakeController();

    const cleanup = registerReconcileTriggers({
      controller,
      proEnabled: () => true,
      reconcileCurrent: vi.fn(async () => undefined)
    });

    expect(controller.handleOrderHint).toHaveBeenCalledOnce();
    expect(controller.handleOrderHint).toHaveBeenCalledWith(hint);
    cleanup();
  });

  it("keeps a hint pending until Pro activation explicitly replays it", () => {
    let proEnabled = false;
    const hint = nostrHint(42);
    const controller = fakeController();
    const cleanup = registerReconcileTriggers({
      controller,
      proEnabled: () => proEnabled,
      reconcileCurrent: vi.fn(async () => undefined)
    });

    publishOrderChangeNotification(hint);
    expect(controller.handleOrderHint).not.toHaveBeenCalled();

    proEnabled = true;
    replayPendingOrderChangeNotifications(PRO_ORDER_CHANGE_CONSUMER_ID);

    expect(controller.handleOrderHint).toHaveBeenCalledOnce();
    expect(controller.handleOrderHint).toHaveBeenCalledWith(hint);
    cleanup();
  });

  it("reconciles a terminal action when no authoritative snapshot was applied", () => {
    const controller = fakeController();
    useProTradeIndexStore.getState().upsertSnapshot({
      key: "slot:lake:42",
      locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
      nickname: "Robot",
      hashId: "hash",
      order: { id: 42, status: 1, is_maker: true } as never,
      renewable: false,
      released: false,
      freshness: "fresh"
    });
    const cleanup = registerReconcileTriggers({
      controller,
      proEnabled: () => true,
      reconcileCurrent: vi.fn(async () => undefined)
    });
    publishCoordinatorOrderActionActivity({
      phase: "complete",
      slotId: "slot",
      shortAlias: "lake",
      orderId: 42,
      snapshotApplied: false
    });

    expect(useProTradeIndexStore.getState().snapshots["slot:lake:42"]).toBeDefined();
    expect(controller.reconcileOrder).toHaveBeenCalledWith(
      { slotId: "slot", shortAlias: "lake", orderId: 42 },
      "order-action"
    );
    cleanup();
  });

  it("marks a foreground action as started", () => {
    const controller = fakeController();
    const cleanup = registerReconcileTriggers({
      controller,
      proEnabled: () => true,
      reconcileCurrent: vi.fn(async () => undefined)
    });

    publishCoordinatorOrderActionActivity({
      phase: "start",
      slotId: "slot",
      shortAlias: "lake",
      orderId: 42
    });

    expect(markProOrderActionStartedMock).toHaveBeenCalledWith({
      phase: "start",
      slotId: "slot",
      shortAlias: "lake",
      orderId: 42
    });
    expect(markProOrderActionFinishedMock).not.toHaveBeenCalled();
    expect(controller.reconcileOrder).not.toHaveBeenCalled();
    cleanup();
  });

  it("does not bypass terminal archiving for a seller action", () => {
    const controller = fakeController();
    useProTradeIndexStore.getState().upsertSnapshot({
      key: "slot:lake:42",
      locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
      nickname: "Robot",
      hashId: "hash",
      order: { id: 42, status: 10, is_maker: true, is_seller: true } as never,
      renewable: false,
      released: false,
      freshness: "fresh"
    });
    const cleanup = registerReconcileTriggers({
      controller,
      proEnabled: () => true,
      reconcileCurrent: vi.fn(async () => undefined)
    });
    publishCoordinatorOrderActionActivity({
      phase: "complete",
      slotId: "slot",
      shortAlias: "lake",
      orderId: 42,
      snapshotApplied: false
    });

    expect(useProTradeIndexStore.getState().snapshots["slot:lake:42"]).toBeDefined();
    expect(controller.reconcileOrder).toHaveBeenCalledWith(
      { slotId: "slot", shortAlias: "lake", orderId: 42 },
      "order-action"
    );
    cleanup();
  });

  it("does not refetch an order whose foreground response was already applied", () => {
    const controller = fakeController();
    const cleanup = registerReconcileTriggers({
      controller,
      proEnabled: () => true,
      reconcileCurrent: vi.fn(async () => undefined)
    });
    publishCoordinatorOrderActionActivity({
      phase: "complete",
      slotId: "slot",
      shortAlias: "lake",
      orderId: 42,
      snapshotApplied: true
    });

    expect(controller.reconcileOrder).not.toHaveBeenCalled();
    cleanup();
  });

  it("stops observing foreground actions during cleanup", () => {
    const controller = fakeController();
    const cleanup = registerReconcileTriggers({
      controller,
      proEnabled: () => true,
      reconcileCurrent: vi.fn(async () => undefined)
    });
    cleanup();

    publishCoordinatorOrderActionActivity({
      phase: "complete",
      slotId: "slot",
      shortAlias: "lake",
      orderId: 42,
      snapshotApplied: false
    });

    expect(controller.reconcileOrder).not.toHaveBeenCalled();
  });

  it("refreshes an order when its displayed deadline expires", async () => {
    const controller = fakeController();
    useProTradeIndexStore.getState().upsertSnapshot({
      key: "slot:lake:42",
      locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
      nickname: "Robot",
      hashId: "hash",
      order: { status: 1, expires_at: new Date(1_500).toISOString() } as never,
      renewable: false,
      released: false,
      freshness: "fresh"
    });

    const cleanup = registerExpiryReconcileTrigger(controller, () => 1_000);
    await vi.advanceTimersByTimeAsync(750);

    expect(controller.reconcileOrder).toHaveBeenCalledWith(
      { slotId: "slot", shortAlias: "lake", orderId: 42 },
      "countdown-expiry"
    );
    cleanup();
  });
});

function dispatchLifecycle(reason: RefreshReason): void {
  publishRefreshIntent(reason);
}

function fakeController(): GarageReconcileController {
  return {
    reconcileAll: vi.fn(async () => undefined),
    reconcileSlot: vi.fn(async () => undefined),
    reconcileOrder: vi.fn(async () => undefined),
    handleOrderHint: vi.fn(async () => true),
    handleNativeOrderHint: vi.fn(async () => true),
    invalidateEpoch: vi.fn()
  };
}

function nostrHint(orderId: number) {
  return {
    source: "nostr" as const,
    recipientPubkey: "robot",
    coordinatorPubkey: "coordinator",
    shortAlias: "lake",
    orderId,
    eventId: `event:${orderId}`,
    createdAt: 1
  };
}
