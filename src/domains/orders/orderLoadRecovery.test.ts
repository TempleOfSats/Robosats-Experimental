import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderDto } from "@/domains/orders/order.types";
import type { OrderLoadFailureKind, OrderLoadResult } from "@/domains/orders/orderStore";
import {
  discardColdOrderLoad,
  isColdOrderLoadActive,
  registerOrderLoadRecovery,
  resetOrderLoadRecoveryForTests,
  type OrderLoadRecoveryPhase
} from "@/domains/orders/orderLoadRecovery";
import {
  publishOrderChangeNotification,
  resetOrderChangeNotificationsForTests
} from "@/domains/orders/orderChangeNotifications";
import {
  publishRefreshIntent,
  resetRefreshIntentLifecycleForTests,
  type RefreshReason
} from "@/domains/transport/refreshIntents";

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
  resetRefreshIntentLifecycleForTests();
  resetOrderChangeNotificationsForTests();
  resetOrderLoadRecoveryForTests();
});

afterEach(() => {
  resetRefreshIntentLifecycleForTests();
  resetOrderChangeNotificationsForTests();
  resetOrderLoadRecoveryForTests();
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
      locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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
        locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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

  it("runs a fresh load after Tor reconnects during an active failed request", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(loadedResult());
    const phases: OrderLoadRecoveryPhase[] = [];
    const recovery = registerOrderLoadRecovery({
      locator: { shortAlias: "lake", orderId: 42 },
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

  it("runs a fresh load after Tor reconnects during an active successful request", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(loadedResult());
    const recovery = registerOrderLoadRecovery({
      locator: { shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn(),
      retryDelayMs: 100
    });

    dispatchLifecycle("tor-reconnected");
    resolveInitial(loadedResult());
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(2, "lifecycle");
    recovery.dispose();
  });

  it("replays a matching notification published before the order owner registers", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(loadedResult());
    publishOrderChangeNotification(nostrHint(42, "lake"));

    const recovery = registerOrderLoadRecovery({
      locator: { shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn()
    });
    resolveInitial(loadedResult());
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith("initial");
    recovery.dispose();
  });

  it("queues one lifecycle load for a matching hint published after the initial request begins", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(loadedResult());
    const recovery = registerOrderLoadRecovery({
      locator: { shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn()
    });

    publishOrderChangeNotification(nostrHint(42, "lake"));
    resolveInitial(loadedResult());
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(2, "lifecycle");
    recovery.dispose();
  });

  it("replays an unstarted hint load to a replacement order owner", async () => {
    let resolveActive!: (result: OrderLoadResult) => void;
    const active = new Promise<OrderLoadResult>((resolve) => {
      resolveActive = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(active).mockResolvedValue(loadedResult());
    const first = registerOrderLoadRecovery({
      activeDelayMs: () => 100,
      locator: { shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn()
    });
    dispatchLifecycle("online");
    publishOrderChangeNotification(nostrHint(42, "lake"));

    first.dispose();
    const second = registerOrderLoadRecovery({
      activeDelayMs: () => 100,
      locator: { shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn()
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(2, "lifecycle");
    resolveActive(loadedResult());
    await vi.advanceTimersByTimeAsync(0);
    second.dispose();
  });

  it("coalesces repeated reconnects and matching hints into one trailing fresh load", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(loadedResult());
    const recovery = registerOrderLoadRecovery({
      locator: { shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn(),
      retryDelayMs: 100
    });

    dispatchLifecycle("tor-reconnected");
    dispatchLifecycle("tor-reconnected");
    publishOrderChangeNotification({ source: "native", orderId: 42 });
    publishOrderChangeNotification(nostrHint(42, "lake"));
    resolveInitial(loadedResult());
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(2, "lifecycle");
    recovery.dispose();
  });

  it("keeps one queued fresh load through the cold-to-loaded reschedule handoff", async () => {
    let activeDelay: number | undefined;
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(initial).mockResolvedValue(loadedResult());
    const recovery = registerOrderLoadRecovery({
      activeDelayMs: () => activeDelay,
      locator: { shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn()
    });

    dispatchLifecycle("tor-reconnected");
    publishOrderChangeNotification(nostrHint(42, "lake"));
    activeDelay = 100;
    recovery.reschedule();
    resolveInitial(loadedResult());
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(2, "lifecycle");

    recovery.reschedule();
    await vi.advanceTimersByTimeAsync(99);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenLastCalledWith("poll");
    recovery.dispose();
  });

  it("cancels a cold auto-retry when loaded polling takes ownership", async () => {
    let activeDelay: number | undefined;
    const load = vi.fn().mockResolvedValueOnce(failedResult("transient")).mockResolvedValue(loadedResult());
    const recovery = registerOrderLoadRecovery({
      activeDelayMs: () => activeDelay,
      locator: { shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn(),
      retryDelayMs: 100
    });
    await vi.advanceTimersByTimeAsync(0);

    activeDelay = 200;
    recovery.reschedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith("poll");
    recovery.dispose();
  });

  it("ignores known nonmatching hints and keeps unknown native hints as a broad fallback", async () => {
    const load = vi.fn().mockResolvedValue(loadedResult());
    const recovery = registerOrderLoadRecovery({
      locator: { shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn(),
      retryDelayMs: 100
    });
    await vi.advanceTimersByTimeAsync(0);

    publishOrderChangeNotification({ source: "native", orderId: 41 });
    publishOrderChangeNotification(nostrHint(42, "temple"));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledOnce();

    publishOrderChangeNotification({ source: "native" });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith("lifecycle");
    recovery.dispose();
  });

  it("does not run a queued Tor refresh after disposal", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(initial).mockResolvedValueOnce(loadedResult());
    const recovery = registerOrderLoadRecovery({
      locator: { shortAlias: "lake", orderId: 42 },
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

  it("shares one cold initial request across an immediate controller replacement", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValue(initial);
    const first = registerOrderLoadRecovery({
      coordinatorEndpoint: "https://lake.example",
      locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn()
    });
    first.dispose();
    const secondPhases: OrderLoadRecoveryPhase[] = [];
    const second = registerOrderLoadRecovery({
      coordinatorEndpoint: "https://lake.example",
      locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: (phase) => secondPhases.push(phase)
    });

    expect(load).toHaveBeenCalledOnce();
    resolveInitial(loadedResult());
    await vi.advanceTimersByTimeAsync(0);

    expect(secondPhases).toEqual(["loading", "idle"]);
    second.dispose();
  });

  it("reports an active cold load only for its exact endpoint and locator", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const locator = { slotId: "slot", shortAlias: "lake", orderId: 42 };
    const recovery = registerOrderLoadRecovery({
      coordinatorEndpoint: "https://lake.example",
      locator,
      load: vi.fn().mockReturnValue(initial),
      onPhaseChange: vi.fn()
    });

    expect(isColdOrderLoadActive("https://lake.example", locator)).toBe(true);
    expect(isColdOrderLoadActive("https://other.example", locator)).toBe(false);
    expect(isColdOrderLoadActive("https://lake.example", { ...locator, slotId: "other-slot" })).toBe(false);
    expect(isColdOrderLoadActive("https://lake.example", { ...locator, shortAlias: "temple" })).toBe(false);
    expect(isColdOrderLoadActive("https://lake.example", { ...locator, orderId: 43 })).toBe(false);

    recovery.dispose();
    expect(isColdOrderLoadActive("https://lake.example", locator)).toBe(true);
    resolveInitial(loadedResult());
    await vi.advanceTimersByTimeAsync(0);
    expect(isColdOrderLoadActive("https://lake.example", locator)).toBe(false);
  });

  it("discards a stale cold load without affecting its eventual settlement", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const locator = { slotId: "slot", shortAlias: "lake", orderId: 42 };
    const recovery = registerOrderLoadRecovery({
      coordinatorEndpoint: "https://lake.example",
      locator,
      load: vi.fn().mockReturnValue(initial),
      onPhaseChange: vi.fn()
    });

    discardColdOrderLoad("https://lake.example", locator);
    expect(isColdOrderLoadActive("https://lake.example", locator)).toBe(false);

    resolveInitial(loadedResult());
    await vi.advanceTimersByTimeAsync(0);
    recovery.dispose();
  });

  it("does not reuse a cold request after the coordinator endpoint changes", async () => {
    const resolvers: Array<(result: OrderLoadResult) => void> = [];
    const load = vi.fn(
      () =>
        new Promise<OrderLoadResult>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const first = registerOrderLoadRecovery({
      coordinatorEndpoint: "https://old-lake.example",
      locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn()
    });
    first.dispose();
    const second = registerOrderLoadRecovery({
      coordinatorEndpoint: "https://new-lake.example",
      locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn()
    });

    expect(load).toHaveBeenCalledTimes(2);
    for (const resolve of resolvers) resolve(loadedResult());
    await vi.advanceTimersByTimeAsync(0);
    second.dispose();
  });

  it("acks a pre-published hint from the shared cold request after replacement", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValue(initial);
    publishOrderChangeNotification(nostrHint(42, "lake"));
    const first = registerOrderLoadRecovery({
      coordinatorEndpoint: "https://lake.example",
      locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn()
    });
    first.dispose();
    const secondPhases: OrderLoadRecoveryPhase[] = [];
    const second = registerOrderLoadRecovery({
      coordinatorEndpoint: "https://lake.example",
      locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: (phase) => secondPhases.push(phase)
    });

    expect(load).toHaveBeenCalledOnce();
    resolveInitial(loadedResult());
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledOnce();
    expect(secondPhases).toEqual(["loading", "idle"]);
    second.dispose();
  });

  it("runs one lifecycle load for a hint published after the shared cold request began", async () => {
    let resolveInitial!: (result: OrderLoadResult) => void;
    const initial = new Promise<OrderLoadResult>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(initial).mockResolvedValue(loadedResult());
    const first = registerOrderLoadRecovery({
      coordinatorEndpoint: "https://lake.example",
      locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn()
    });
    first.dispose();
    publishOrderChangeNotification(nostrHint(42, "lake"));

    const second = registerOrderLoadRecovery({
      coordinatorEndpoint: "https://lake.example",
      locator: { slotId: "slot", shortAlias: "lake", orderId: 42 },
      load,
      onPhaseChange: vi.fn()
    });

    expect(load).toHaveBeenCalledOnce();
    resolveInitial(loadedResult());
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(2, "lifecycle");
    second.dispose();
  });

  it("clears a scheduled retry and lifecycle subscription when disposed", async () => {
    const load = vi.fn().mockResolvedValue(failedResult("transient"));
    const recovery = registerOrderLoadRecovery({
      locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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
  it("coalesces pending matching notifications into one late-owner refresh", async () => {
    publishOrderChangeNotification(nostrHint(42, "lake"));
    publishOrderChangeNotification(nostrHint(42, "lake"));
    const load = vi.fn().mockResolvedValue(loadedResult());

    const stop = registerLoadedOrderRefresh({
      activeDelayMs: () => 100,
      locator: { shortAlias: "lake", orderId: 42 },
      load,
      pauseWhileHidden: false
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith("lifecycle");
    stop();
  });

  it("refreshes only matching order notifications and accepts the unknown native fallback", async () => {
    const load = vi.fn().mockResolvedValue(loadedResult());
    const stop = registerLoadedOrderRefresh({
      activeDelayMs: () => 100,
      locator: { shortAlias: "lake", orderId: 42 },
      load,
      pauseWhileHidden: false
    });

    publishOrderChangeNotification({ source: "native", orderId: 41 });
    publishOrderChangeNotification(nostrHint(42, "temple"));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).not.toHaveBeenCalled();

    publishOrderChangeNotification(nostrHint(42, "lake"));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenLastCalledWith("lifecycle");

    publishOrderChangeNotification({ source: "native" });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it("restarts native polling after returning from the background", async () => {
    const load = vi.fn().mockResolvedValue(loadedResult());
    const stop = registerLoadedOrderRefresh({
      activeDelayMs: () => 100,
      locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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
      locator: { shortAlias: "lake", orderId: 42 },
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

function nostrHint(orderId: number, shortAlias: string) {
  return {
    source: "nostr" as const,
    recipientPubkey: "robot",
    coordinatorPubkey: "coordinator",
    shortAlias,
    orderId,
    eventId: `${shortAlias}:${orderId}`,
    createdAt: 1
  };
}

function dispatchLifecycle(reason: RefreshReason): void {
  publishRefreshIntent(reason);
}

function registerLoadedOrderRefresh(options: {
  activeDelayMs(): number;
  locator: { shortAlias: string; orderId: number };
  load(reason: "lifecycle" | "maintenance" | "poll"): Promise<OrderLoadResult>;
  pauseWhileHidden: boolean;
}): () => void {
  const recovery = registerOrderLoadRecovery({
    activeDelayMs: options.activeDelayMs,
    locator: options.locator,
    load: (reason) => options.load(reason as "lifecycle" | "maintenance" | "poll"),
    onPhaseChange: vi.fn(),
    pauseWhileHidden: options.pauseWhileHidden
  });
  return () => recovery.dispose();
}
