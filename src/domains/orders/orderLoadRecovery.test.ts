import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderDto } from "@/domains/orders/order.types";
import type { OrderLoadFailureKind, OrderLoadResult } from "@/domains/orders/orderStore";
import {
  registerLoadedOrderRefresh,
  registerOrderLoadRecovery,
  type OrderLoadRecoveryPhase
} from "@/domains/orders/orderLoadRecovery";
import { resetRefreshIntentsForTests, type RefreshReason } from "@/domains/transport/refreshIntents";

let windowTarget: EventTarget & Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
let documentTarget: EventTarget & {
  hidden: boolean;
  visibilityState: DocumentVisibilityState;
};

beforeEach(() => {
  vi.useFakeTimers();
  windowTarget = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  });
  documentTarget = Object.assign(new EventTarget(), {
    hidden: false,
    visibilityState: "visible" as DocumentVisibilityState
  });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  resetRefreshIntentsForTests();
});

afterEach(() => {
  resetRefreshIntentsForTests();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("order load recovery", () => {
  it("automatically retries one transient initial failure and then stops", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(failedResult("transient"))
      .mockResolvedValueOnce(failedResult("transient"));
    const phases: OrderLoadRecoveryPhase[] = [];
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:42",
      load,
      onPhaseChange: (phase) => phases.push(phase),
      retryDelayMs: 100
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(["loading", "waiting-to-retry"]);

    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(2, "initial");
    expect(phases).toEqual(["loading", "waiting-to-retry", "retrying", "idle"]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(load).toHaveBeenCalledTimes(2);
    recovery.dispose();
  });

  it("returns to idle when the automatic retry succeeds", async () => {
    const load = vi.fn().mockResolvedValueOnce(failedResult("transient")).mockResolvedValueOnce(loadedResult());
    const phases: OrderLoadRecoveryPhase[] = [];
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:42",
      load,
      onPhaseChange: (phase) => phases.push(phase),
      retryDelayMs: 100
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(load).toHaveBeenCalledTimes(2);
    expect(phases.at(-1)).toBe("idle");
    recovery.dispose();
  });

  it("does not repeat a transient request that already took a long time", async () => {
    const load = vi.fn(
      () =>
        new Promise<OrderLoadResult>((resolve) => {
          window.setTimeout(() => resolve(failedResult("transient")), 101);
        })
    );
    const phases: OrderLoadRecoveryPhase[] = [];
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:slow",
      load,
      onPhaseChange: (phase) => phases.push(phase),
      autoRetryWindowMs: 100,
      retryDelayMs: 50
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(load).toHaveBeenCalledOnce();
    expect(phases).toEqual(["loading", "idle"]);
    recovery.dispose();
  });

  it("retries an unchanged initial load when no order is available", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ status: "unchanged" } satisfies OrderLoadResult)
      .mockResolvedValueOnce({ status: "unchanged" } satisfies OrderLoadResult);
    const phases: OrderLoadRecoveryPhase[] = [];
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:42",
      load,
      onPhaseChange: (phase) => phases.push(phase),
      retryDelayMs: 100
    });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(load).toHaveBeenCalledTimes(2);
    expect(phases).toEqual(["loading", "waiting-to-retry", "retrying", "idle"]);
    recovery.dispose();
  });

  it("does not retry an unchanged initial load when an order is available", async () => {
    const order = { id: 42, shortAlias: "lake" } as OrderDto;
    const load = vi.fn().mockResolvedValue({
      status: "unchanged",
      order
    } satisfies OrderLoadResult);
    const phases: OrderLoadRecoveryPhase[] = [];
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:42",
      load,
      onPhaseChange: (phase) => phases.push(phase),
      retryDelayMs: 100
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(load).toHaveBeenCalledOnce();
    expect(phases).toEqual(["loading", "idle"]);
    recovery.dispose();
  });

  it.each<OrderLoadFailureKind>(["authentication", "not-found", "terminal"])(
    "does not automatically retry a %s failure",
    async (kind) => {
      const load = vi.fn().mockResolvedValue(failedResult(kind));
      const phases: OrderLoadRecoveryPhase[] = [];
      const recovery = registerOrderLoadRecovery({
        key: `order:lake:${kind}`,
        load,
        onPhaseChange: (phase) => phases.push(phase),
        retryDelayMs: 100
      });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(load).toHaveBeenCalledOnce();
      expect(phases).toEqual(["loading", "idle"]);
      recovery.dispose();
    }
  );

  it("refreshes on lifecycle intent before an order has loaded", async () => {
    const load = vi.fn().mockResolvedValueOnce(failedResult("transient")).mockResolvedValueOnce(loadedResult());
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:42",
      load,
      onPhaseChange: vi.fn(),
      retryDelayMs: 100
    });
    await vi.advanceTimersByTimeAsync(0);

    dispatchLifecycle("tor-reconnected");
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(2, "lifecycle");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(load).toHaveBeenCalledTimes(2);
    recovery.dispose();
  });

  it("coalesces manual and lifecycle intents with an in-flight initial load", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(loadedResult());
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:42",
      load,
      onPhaseChange: vi.fn(),
      retryDelayMs: 100
    });

    recovery.retry();
    dispatchLifecycle("online");
    expect(load).toHaveBeenCalledOnce();

    resolveInitial(failedResult("transient"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(load).toHaveBeenCalledOnce();

    recovery.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(2, "manual");
    recovery.dispose();
  });

  it("runs a fresh load after Tor reconnects during an active request", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(loadedResult());
    const phases: OrderLoadRecoveryPhase[] = [];
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:42",
      load,
      onPhaseChange: (phase) => phases.push(phase),
      retryDelayMs: 100
    });

    dispatchLifecycle("tor-reconnected");
    expect(load).toHaveBeenCalledOnce();

    resolveInitial(failedResult("transient"));
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(2, "lifecycle");
    expect(phases.at(-1)).toBe("idle");
    recovery.dispose();
  });

  it("does not run a queued Tor refresh after disposal", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(loadedResult());
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:42",
      load,
      onPhaseChange: vi.fn(),
      retryDelayMs: 100
    });

    dispatchLifecycle("tor-reconnected");
    recovery.dispose();
    resolveInitial(failedResult("transient"));
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledOnce();
  });

  it("clears a scheduled retry and lifecycle subscription when disposed", async () => {
    const load = vi.fn().mockResolvedValue(failedResult("transient"));
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:42",
      load,
      onPhaseChange: vi.fn(),
      retryDelayMs: 100
    });
    await vi.advanceTimersByTimeAsync(0);

    recovery.dispose();
    dispatchLifecycle("online");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(load).toHaveBeenCalledOnce();
  });

  it("ignores an initial request that settles after disposal", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValue(initial);
    const onPhaseChange = vi.fn();
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:42",
      load,
      onPhaseChange,
      retryDelayMs: 100
    });

    recovery.dispose();
    resolveInitial(failedResult("transient"));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(load).toHaveBeenCalledOnce();
    expect(onPhaseChange).toHaveBeenCalledOnce();
    expect(onPhaseChange).toHaveBeenCalledWith("loading");
  });

  it("uses a jittered two-second retry delay by default", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const load = vi.fn().mockResolvedValueOnce(failedResult("transient")).mockResolvedValueOnce(loadedResult());
    const recovery = registerOrderLoadRecovery({
      key: "order:lake:42",
      load,
      onPhaseChange: vi.fn()
    });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(load).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    recovery.dispose();
  });
});

describe("loaded order refresh", () => {
  it("restarts native polling after returning from the background", async () => {
    const load = vi.fn().mockResolvedValue(loadedResult());
    const stop = registerLoadedOrderRefresh({
      activeDelayMs: () => 100,
      key: "order:lake:42",
      load,
      pauseWhileHidden: true
    });

    documentTarget.hidden = true;
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(500);
    expect(load).not.toHaveBeenCalled();

    documentTarget.hidden = false;
    documentTarget.visibilityState = "visible";
    dispatchLifecycle("resume");
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenLastCalledWith("lifecycle");

    await vi.advanceTimersByTimeAsync(99);
    expect(load).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith("poll");
    stop();
  });

  it("resets the polling cadence after a lifecycle refresh", async () => {
    const load = vi.fn().mockResolvedValue(loadedResult());
    const stop = registerLoadedOrderRefresh({
      activeDelayMs: () => 100,
      key: "order:lake:42",
      load,
      pauseWhileHidden: false
    });

    await vi.advanceTimersByTimeAsync(50);
    dispatchLifecycle("online");
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenLastCalledWith("lifecycle");

    await vi.advanceTimersByTimeAsync(99);
    expect(load).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith("poll");
    stop();
  });

  it("loads again on the new circuit when Tor reconnects during a poll", async () => {
    let resolvePoll!: (result: OrderLoadResult) => void;
    const poll = new Promise<OrderLoadResult>((resolve) => {
      resolvePoll = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(poll).mockResolvedValueOnce(loadedResult());
    const stop = registerLoadedOrderRefresh({
      activeDelayMs: () => 100,
      key: "order:lake:42",
      load,
      pauseWhileHidden: false
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenLastCalledWith("poll");

    dispatchLifecycle("tor-reconnected");
    resolvePoll(loadedResult());
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith("lifecycle");
    stop();
  });

  it("does not run a queued Tor refresh after the loaded controller is disposed", async () => {
    let resolvePoll!: (result: OrderLoadResult) => void;
    const poll = new Promise<OrderLoadResult>((resolve) => {
      resolvePoll = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(poll).mockResolvedValueOnce(loadedResult());
    const stop = registerLoadedOrderRefresh({
      activeDelayMs: () => 100,
      key: "order:lake:42",
      load,
      pauseWhileHidden: false
    });

    await vi.advanceTimersByTimeAsync(100);
    dispatchLifecycle("tor-reconnected");
    stop();
    resolvePoll(loadedResult());
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledOnce();
  });

  it("stops timers and lifecycle refreshes after disposal", async () => {
    const load = vi.fn().mockResolvedValue(loadedResult());
    const stop = registerLoadedOrderRefresh({
      activeDelayMs: () => 100,
      key: "order:lake:42",
      load,
      pauseWhileHidden: false
    });

    stop();
    dispatchLifecycle("online");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(load).not.toHaveBeenCalled();
  });
});

function failedResult(kind: OrderLoadFailureKind): OrderLoadResult {
  return {
    status: "failed",
    failure: {
      kind,
      message: kind === "transient" ? "The trade is taking longer to open." : "Could not load trade."
    }
  };
}

function loadedResult(): OrderLoadResult {
  return {
    status: "loaded",
    order: { id: 42, shortAlias: "lake" } as OrderDto
  };
}

function dispatchLifecycle(reason: RefreshReason): void {
  const event = new Event("robosats:refresh-intent");
  Object.defineProperty(event, "detail", { value: { reason } });
  windowTarget.dispatchEvent(event);
}
