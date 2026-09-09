import { afterEach, describe, expect, it, vi } from "vitest";

import { startBackgroundRuntime } from "@/app/backgroundRuntime";
import { publishRefreshIntent, resetRefreshIntentLifecycleForTests } from "@/domains/transport/refreshIntents";

const { reportUnavailable } = vi.hoisted(() => ({ reportUnavailable: vi.fn() }));

vi.mock("@/app/runtimeNotice", () => ({ reportRuntimeUnavailable: reportUnavailable }));

type FakeRuntime = { start: () => () => void };

const FLEET = "RoboSats could not start Fleet synchronization.";

let unhandled: unknown[] = [];

function captureUnhandledRejections(): void {
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
}

function onUnhandled(reason: unknown): void {
  unhandled.push(reason);
}

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  resetRefreshIntentLifecycleForTests();
  reportUnavailable.mockReset();
  vi.restoreAllMocks();
});

describe("required background runtimes", () => {
  it("starts the runtime once and stops it with the returned cleanup", async () => {
    const stopRuntime = vi.fn();
    const start = vi.fn(() => stopRuntime);
    const load = vi.fn(async (): Promise<FakeRuntime> => ({ start }));

    const stop = startBackgroundRuntime(load, (runtime) => runtime.start(), FLEET);
    await settle();

    expect(load).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(stopRuntime).not.toHaveBeenCalled();
    expect(reportUnavailable).not.toHaveBeenCalled();

    stop();
    expect(stopRuntime).toHaveBeenCalledOnce();
  });

  it("reports a runtime chunk that never arrived without retrying it in this document", async () => {
    // Chromium caches the rejected module load, so importing the specifier again
    // would fail too. Recovery is the reload the notice offers, not a hidden retry.
    const load = vi.fn(async (): Promise<FakeRuntime> => {
      throw new Error("runtime chunk unavailable");
    });

    const stop = startBackgroundRuntime(load, () => undefined, FLEET);
    await settle();

    expect(reportUnavailable).toHaveBeenCalledWith(FLEET);

    publishRefreshIntent("tor-reconnected");
    publishRefreshIntent("focus");
    await settle();

    expect(load).toHaveBeenCalledOnce();
    expect(reportUnavailable).toHaveBeenCalledOnce();
    stop();
  });

  it("does not duplicate partial startup work after an initializer throws", async () => {
    captureUnhandledRejections();
    const stopRuntime = vi.fn();
    const registerPartialWork = vi.fn();
    let attempts = 0;
    const load = vi.fn(async (): Promise<FakeRuntime> => ({ start: () => stopRuntime }));

    const stop = startBackgroundRuntime(
      load,
      () => {
        attempts += 1;
        if (attempts === 1) {
          registerPartialWork();
          throw new Error("runtime refused to start");
        }
        return stopRuntime;
      },
      FLEET
    );
    await settle();

    expect(registerPartialWork).toHaveBeenCalledOnce();
    expect(reportUnavailable).toHaveBeenCalledWith(FLEET);
    expect(stopRuntime).not.toHaveBeenCalled();

    publishRefreshIntent("resume");
    await settle();

    expect(attempts).toBe(1);
    expect(stopRuntime).not.toHaveBeenCalled();

    publishRefreshIntent("focus");
    await settle();
    publishRefreshIntent("tor-reconnected");
    await settle();
    expect(attempts).toBe(1);
    expect(registerPartialWork).toHaveBeenCalledOnce();

    stop();
    expect(stopRuntime).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).toEqual([]);
  });

  it("clears its notice once when a failed owner stops", async () => {
    const clearNotice = vi.fn();
    reportUnavailable.mockReturnValueOnce(clearNotice);
    const stop = startBackgroundRuntime(
      async () => {
        throw new Error("unavailable");
      },
      () => undefined,
      FLEET
    );
    await settle();

    stop();
    stop();

    expect(clearNotice).toHaveBeenCalledOnce();
  });

  it("keeps one registered runtime when a healthy runtime is left alone", async () => {
    const start = vi.fn(() => vi.fn());
    const load = vi.fn(async (): Promise<FakeRuntime> => ({ start }));

    const stop = startBackgroundRuntime(load, (runtime) => runtime.start(), FLEET);
    await settle();

    publishRefreshIntent("online");
    publishRefreshIntent("tor-ready");
    await settle();

    expect(load).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(reportUnavailable).not.toHaveBeenCalled();
    stop();
  });

  it("does not report again once the owner has stopped, and does not restart", async () => {
    const load = vi.fn(async (): Promise<FakeRuntime> => ({ start: () => () => undefined }));
    let attempts = 0;

    const stop = startBackgroundRuntime(
      load,
      () => {
        attempts += 1;
        throw new Error("runtime refused to start");
      },
      FLEET
    );
    await settle();
    expect(attempts).toBe(1);
    expect(reportUnavailable).toHaveBeenCalledOnce();

    stop();
    reportUnavailable.mockClear();
    publishRefreshIntent("tor-ready");
    await settle();

    expect(attempts).toBe(1);
    expect(reportUnavailable).not.toHaveBeenCalled();
  });

  it("drops a runtime chunk that arrives after the owner stopped", async () => {
    const start = vi.fn(() => vi.fn());
    let release: ((runtime: FakeRuntime) => void) | undefined;
    const stop = startBackgroundRuntime(
      () =>
        new Promise<FakeRuntime>((resolve) => {
          release = resolve;
        }),
      (runtime) => runtime.start(),
      FLEET
    );

    stop();
    release!({ start });
    await settle();

    expect(start).not.toHaveBeenCalled();
    expect(reportUnavailable).not.toHaveBeenCalled();
  });

  it("does not report a chunk that fails after the owner stopped", async () => {
    const start = vi.fn(() => vi.fn());
    let reject: ((error: Error) => void) | undefined;
    const stop = startBackgroundRuntime(
      () =>
        new Promise<FakeRuntime>((_resolve, rej) => {
          reject = rej;
        }),
      (runtime) => runtime.start(),
      FLEET
    );

    stop();
    reject!(new Error("runtime chunk unavailable"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(start).not.toHaveBeenCalled();
    expect(reportUnavailable).not.toHaveBeenCalled();
  });
});

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}
