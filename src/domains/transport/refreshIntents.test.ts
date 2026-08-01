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
  it("returns the refresh result", async () => {
    resetRefreshIntentsForTests();

    const result = await runRefreshIntent("order:lake:41", () => ({ status: "ready", revision: 3 }));

    expect(result.status).toBe("ready");
    expect(result.revision).toBe(3);
  });

  it("coalesces concurrent signals with the same refresh result", async () => {
    resetRefreshIntentsForTests();
    let resolve: ((value: string) => void) | undefined;
    const refresh = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const first = runRefreshIntent("order:lake:42", refresh);
    const second = runRefreshIntent("order:lake:42", refresh);
    expect(first).toBe(second);
    expect(refresh).toHaveBeenCalledOnce();
    resolve?.("updated");
    await expect(first).resolves.toBe("updated");
    await expect(second).resolves.toBe("updated");
  });

  it("runs a trailing refresh after active work settles", async () => {
    resetRefreshIntentsForTests();
    let resolveActive: ((value: string) => void) | undefined;
    const active = runRefreshIntent(
      "order:lake:43",
      () => new Promise<string>((resolve) => { resolveActive = resolve; })
    );
    const trailingRefresh = vi.fn(() => "fresh");

    const trailing = runRefreshIntent(
      "order:lake:43",
      trailingRefresh,
      { afterActive: true }
    );
    expect(trailingRefresh).not.toHaveBeenCalled();

    resolveActive?.("old");

    await expect(active).resolves.toBe("old");
    await expect(trailing).resolves.toBe("fresh");
    expect(trailingRefresh).toHaveBeenCalledOnce();
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

  it("suppresses a lower-priority native resume immediately after Tor reconnects", async () => {
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

    windowTarget.dispatchEvent(new Event("robosats:tor-reconnected"));
    windowTarget.dispatchEvent(new Event("robosats:native-resume"));
    await vi.advanceTimersByTimeAsync(750);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("tor-reconnected");
    unsubscribe();
    cleanup();
  });
});
