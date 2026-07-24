import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installRefreshIntentLifecycle,
  ORDER_CHANGE_HINT_REFRESH_EVENT,
  resetRefreshIntentsForTests,
  runRefreshIntent,
  subscribeRefreshIntents
} from "@/domains/transport/refreshIntents";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("refresh intents", () => {
  it("coalesces concurrent signals for the same route resource", async () => {
    resetRefreshIntentsForTests();
    let resolve: (() => void) | undefined;
    const refresh = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const first = runRefreshIntent("order:lake:42", refresh);
    const second = runRefreshIntent("order:lake:42", refresh);
    expect(first).toBe(second);
    expect(refresh).toHaveBeenCalledOnce();
    resolve?.();
    await first;
  });

  it("emits one preferred lifecycle intent for overlapping foreground signals", async () => {
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
    const cleanup = installRefreshIntentLifecycle();
    const listener = vi.fn();
    const unsubscribe = subscribeRefreshIntents(listener);

    windowTarget.dispatchEvent(new Event("focus"));
    windowTarget.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(750);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("online");
    unsubscribe();
    cleanup();
  });

  it("emits native order notifications immediately", () => {
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
    const cleanup = installRefreshIntentLifecycle();
    const listener = vi.fn();
    const unsubscribe = subscribeRefreshIntents(listener);

    windowTarget.dispatchEvent(new CustomEvent("robosats:native-order-hint"));

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("notification");
    unsubscribe();
    cleanup();
  });

  it("emits decrypted web order hints immediately", () => {
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
    const cleanup = installRefreshIntentLifecycle();
    const listener = vi.fn();
    const unsubscribe = subscribeRefreshIntents(listener);

    windowTarget.dispatchEvent(new Event(ORDER_CHANGE_HINT_REFRESH_EVENT));

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("notification");
    unsubscribe();
    cleanup();
  });
});
