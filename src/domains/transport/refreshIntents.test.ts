import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installRefreshIntentLifecycle,
  publishRefreshIntent,
  resetRefreshIntentLifecycleForTests,
  subscribeRefreshIntents
} from "@/domains/transport/refreshIntents";

afterEach(() => {
  resetRefreshIntentLifecycleForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("refresh intents", () => {
  it("delivers typed lifecycle reasons and supports unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRefreshIntents(listener);

    publishRefreshIntent("online");
    unsubscribe();
    publishRefreshIntent("tor-ready");

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("online");
  });

  it("collapses equivalent focus and resume signals", async () => {
    const { documentTarget, windowTarget } = lifecycleHarness();
    const cleanup = installRefreshIntentLifecycle();
    const listener = vi.fn();
    const unsubscribe = subscribeRefreshIntents(listener);

    windowTarget.dispatchEvent(new Event("focus"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(750);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("resume");
    unsubscribe();
    cleanup();
  });

  it("collapses paired foreground and online signals to the higher-priority reason", async () => {
    const { windowTarget } = lifecycleHarness();
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

  it("collapses the native resume paired with a Tor reconnect", async () => {
    const { windowTarget } = lifecycleHarness();
    const cleanup = installRefreshIntentLifecycle();
    const listener = vi.fn();
    const unsubscribe = subscribeRefreshIntents(listener);

    windowTarget.dispatchEvent(new Event("robosats:tor-reconnected"));
    windowTarget.dispatchEvent(new Event("robosats:native-resume"));
    await vi.advanceTimersByTimeAsync(750);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("tor-reconnected");
    unsubscribe();
    cleanup();
  });

  it("allows an independent focus after the Tor coalescing window", async () => {
    const { windowTarget } = lifecycleHarness();
    const cleanup = installRefreshIntentLifecycle();
    const listener = vi.fn();
    const unsubscribe = subscribeRefreshIntents(listener);

    windowTarget.dispatchEvent(new Event("robosats:tor-reconnected"));
    await vi.advanceTimersByTimeAsync(750);
    windowTarget.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(750);

    expect(listener.mock.calls).toEqual([["tor-reconnected"], ["focus"]]);
    unsubscribe();
    cleanup();
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
