import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GarageReconcileController } from "@/domains/pro/garageReconciler";
import { registerReconcileTriggers } from "@/domains/pro/reconcileTriggers";

let windowTarget: EventTarget & Pick<typeof globalThis, "setTimeout" | "clearTimeout" | "setInterval" | "clearInterval">;
let documentTarget: EventTarget & { visibilityState: DocumentVisibilityState };

beforeEach(() => {
  vi.useFakeTimers();
  windowTarget = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval
  });
  documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
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

    windowTarget.dispatchEvent(new Event("focus"));
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

    windowTarget.dispatchEvent(new Event("robosats:tor-reconnected"));
    expect(controller.invalidateEpoch).toHaveBeenCalledOnce();
    expect(controller.reconcileAll).toHaveBeenCalledWith("tor-reconnected");
    cleanup();
  });
});

function fakeController(): GarageReconcileController {
  return {
    reconcileAll: vi.fn(async () => undefined),
    reconcileSlot: vi.fn(async () => undefined),
    reconcileOrder: vi.fn(async () => undefined),
    handleOrderHint: vi.fn(async () => undefined),
    invalidateEpoch: vi.fn()
  };
}
