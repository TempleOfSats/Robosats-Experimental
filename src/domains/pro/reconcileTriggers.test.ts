import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  publishCoordinatorOrderActionActivity,
  resetCoordinatorOrderActivityForTests
} from "@/domains/orders/orderActivity";
import type { GarageReconcileController } from "@/domains/pro/garageReconciler";
import { registerExpiryReconcileTrigger, registerReconcileTriggers } from "@/domains/pro/reconcileTriggers";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";

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
  useProTradeIndexStore.getState().resetRuntimeCache();
});

afterEach(() => {
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

function dispatchLifecycle(reason: string): void {
  const event = new Event("robosats:refresh-intent");
  Object.defineProperty(event, "detail", { value: { reason } });
  windowTarget.dispatchEvent(event);
}

function fakeController(): GarageReconcileController {
  return {
    reconcileAll: vi.fn(async () => undefined),
    reconcileSlot: vi.fn(async () => undefined),
    reconcileOrder: vi.fn(async () => undefined),
    handleOrderHint: vi.fn(async () => undefined),
    invalidateEpoch: vi.fn()
  };
}
