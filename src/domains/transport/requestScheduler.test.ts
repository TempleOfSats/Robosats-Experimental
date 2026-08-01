import { afterEach, describe, expect, it, vi } from "vitest";
import { CoordinatorRequestScheduler } from "@/domains/transport/requestScheduler";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CoordinatorRequestScheduler", () => {
  it("reserves mobile transport capacity for an action", async () => {
    vi.stubGlobal("window", { AndroidAppRobosats: { httpRequest: vi.fn() } });
    const scheduler = new CoordinatorRequestScheduler();
    const releases = [deferred<void>(), deferred<void>(), deferred<void>()];
    const started: string[] = [];

    const first = scheduler.schedule(
      request("a", "background"),
      async () => { started.push("a"); await releases[0].promise; return "a"; }
    );
    const second = scheduler.schedule(
      request("b", "background"),
      async () => { started.push("b"); await releases[1].promise; return "b"; }
    );
    const queued = scheduler.schedule(
      request("c", "background"),
      async () => { started.push("c"); await releases[2].promise; return "c"; }
    );
    const action = scheduler.schedule(
      request("action", "action"),
      async () => { started.push("action"); return "done"; }
    );

    await vi.waitFor(() => expect(started).toEqual(["action", "a", "b"]));
    await expect(action.promise).resolves.toBe("done");
    releases[0].resolve();
    await vi.waitFor(() => expect(started).toContain("c"));
    releases[1].resolve();
    releases[2].resolve();
    await Promise.all([first.promise, second.promise, queued.promise]);
  });

  it("enforces two concurrent requests per origin", async () => {
    const scheduler = new CoordinatorRequestScheduler();
    const release = deferred<void>();
    let active = 0;
    let maximum = 0;

    const tasks = Array.from({ length: 4 }, (_, index) => scheduler.schedule(
      { ...request(`task-${index}`, "visible"), origin: "http://same.onion" },
      async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await release.promise;
        active -= 1;
        return index;
      }
    ));

    await vi.waitFor(() => expect(maximum).toBe(2));
    release.resolve();
    await Promise.all(tasks.map((task) => task.promise));
    expect(maximum).toBe(2);
  });

  it("spreads a batch across origins before admitting a second request for one origin", async () => {
    const scheduler = new CoordinatorRequestScheduler();
    const release = deferred<void>();
    const started: string[] = [];
    const origins = ["first", "first", "second", "second", "third", "third", "fourth"];
    const tasks = origins.map((origin, index) => scheduler.schedule(
      { ...request(`${origin}-${index}`, "visible"), origin: `http://${origin}.onion` },
      async () => {
        started.push(`${origin}-${index}`);
        await release.promise;
      }
    ));

    await vi.waitFor(() => expect(started).toHaveLength(4));
    expect(new Set(started.map((value) => value.split("-")[0]))).toEqual(
      new Set(["first", "second", "third", "fourth"])
    );
    release.resolve();
    await Promise.all(tasks.map((task) => task.promise));
  });

  it("reports only user-priority work as blocking opportunistic warm-up", async () => {
    const scheduler = new CoordinatorRequestScheduler();
    const backgroundRelease = deferred<void>();
    const visibleRelease = deferred<void>();
    const background = scheduler.schedule(
      request("background", "background"),
      async () => backgroundRelease.promise
    );

    await vi.waitFor(() => expect(scheduler.hasUserPriorityWork()).toBe(false));

    const visible = scheduler.schedule(
      request("visible", "visible"),
      async () => visibleRelease.promise
    );
    await vi.waitFor(() => expect(scheduler.hasUserPriorityWork()).toBe(true));

    visibleRelease.resolve();
    await visible.promise;
    await vi.waitFor(() => expect(scheduler.hasUserPriorityWork()).toBe(false));

    backgroundRelease.resolve();
    await background.promise;
  });

  it("defers background work after repeated origin failures but permits visible recovery", async () => {
    const scheduler = new CoordinatorRequestScheduler();
    const origin = "http://offline.onion";
    scheduler.noteOriginFailure(origin);
    scheduler.noteOriginFailure(origin);

    const backgroundExecute = vi.fn(async () => "background");
    const background = scheduler.schedule(
      { ...request("background", "background"), origin },
      backgroundExecute
    );
    const visibleExecute = vi.fn(async () => "visible");
    const visible = scheduler.schedule(
      { ...request("visible", "visible"), origin },
      visibleExecute
    );

    await expect(background.promise).rejects.toMatchObject({
      name: "CoordinatorRequestDeferredError"
    });
    await expect(visible.promise).resolves.toBe("visible");
    expect(backgroundExecute).not.toHaveBeenCalled();
    expect(visibleExecute).toHaveBeenCalledOnce();
  });

  it("allows an explicit background request to bypass an open circuit", async () => {
    const scheduler = new CoordinatorRequestScheduler();
    const origin = "http://manual-refresh.onion";
    scheduler.noteOriginFailure(origin);
    scheduler.noteOriginFailure(origin);

    const execute = vi.fn(async () => "refreshed");
    const requestHandle = scheduler.schedule(
      { ...request("manual", "maintenance"), bypassCircuit: true, origin },
      execute
    );

    await expect(requestHandle.promise).resolves.toBe("refreshed");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("admits one half-open background probe after the retry window", async () => {
    vi.useFakeTimers();
    const scheduler = new CoordinatorRequestScheduler();
    const origin = "http://recovering.onion";
    scheduler.noteOriginFailure(origin);
    scheduler.noteOriginFailure(origin);
    await vi.advanceTimersByTimeAsync(120_000);

    const release = deferred<void>();
    const started: string[] = [];
    const probe = scheduler.schedule(
      { ...request("probe", "background"), origin },
      async () => {
        started.push("probe");
        await release.promise;
      }
    );
    const deferredProbe = scheduler.schedule(
      { ...request("extra", "background"), origin },
      async () => { started.push("extra"); }
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["probe"]);
    release.resolve();
    await probe.promise;
    scheduler.noteOriginReachable(origin);
    await vi.advanceTimersByTimeAsync(0);
    await deferredProbe.promise;
    expect(started).toEqual(["probe", "extra"]);
    vi.useRealTimers();
  });

  it("promotes a coalesced queued GET", async () => {
    vi.stubGlobal("window", { AndroidAppRobosats: { httpRequest: vi.fn() } });
    const scheduler = new CoordinatorRequestScheduler();
    const blockers = [deferred<void>(), deferred<void>()];
    const started: string[] = [];
    const running = blockers.map((blocker, index) => scheduler.schedule(
      request(`block-${index}`, "background"),
      async () => {
        started.push(`block-${index}`);
        await blocker.promise;
      }
    ));

    const background = scheduler.schedule(
      { ...request("shared", "background"), key: "shared" },
      async () => { started.push("shared"); return 42; }
    );
    const other = scheduler.schedule(
      request("other", "background"),
      async () => { started.push("other"); return 7; }
    );
    const promoted = scheduler.schedule(
      { ...request("shared-visible", "visible"), key: "shared", origin: "http://shared.onion" },
      async () => { throw new Error("coalesced execution must not run"); }
    );

    blockers[0].resolve();
    await vi.waitFor(() => expect(started[0]).toBe("shared"));
    await expect(Promise.all([background.promise, promoted.promise])).resolves.toEqual([42, 42]);
    blockers[1].resolve();
    await other.promise;
    await Promise.all(running.map((task) => task.promise));
  });

  it("extends the timeout when a visible caller joins a background request", async () => {
    vi.useFakeTimers();
    const scheduler = new CoordinatorRequestScheduler();
    const release = deferred<number>();
    const execute = vi.fn(async () => release.promise);
    const background = scheduler.schedule(
      { ...request("shared", "background"), key: "shared", timeoutMs: 20_000 },
      execute
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const visible = scheduler.schedule(
      { ...request("shared", "visible"), key: "shared", timeoutMs: 45_000 },
      async () => 0
    );
    await vi.advanceTimersByTimeAsync(15_000);
    release.resolve(42);

    await expect(Promise.all([background.promise, visible.promise])).resolves.toEqual([42, 42]);
    expect(execute).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("makes a superseding request the new coalescing owner without cancelling older callers", async () => {
    const scheduler = new CoordinatorRequestScheduler();
    const oldRelease = deferred<string>();
    const concurrentRelease = deferred<string>();
    const freshRelease = deferred<string>();
    const oldExecute = vi.fn(async () => oldRelease.promise);
    const concurrentExecute = vi.fn(async () => concurrentRelease.promise);
    const freshExecute = vi.fn(async () => freshRelease.promise);
    const followerExecute = vi.fn(async () => "unexpected");
    const sharedRequest = {
      ...request("shared", "visible"),
      key: "shared",
      origin: "http://shared.onion"
    };

    const old = scheduler.schedule(sharedRequest, oldExecute);
    const concurrent = scheduler.schedule(
      { ...request("concurrent", "visible"), origin: sharedRequest.origin },
      concurrentExecute
    );
    await vi.waitFor(() => {
      expect(oldExecute).toHaveBeenCalledOnce();
      expect(concurrentExecute).toHaveBeenCalledOnce();
    });
    const fresh = scheduler.schedule({ ...sharedRequest, supersedeInFlight: true }, freshExecute);
    await vi.waitFor(() => expect(freshExecute).toHaveBeenCalledOnce());

    oldRelease.resolve("old");
    await expect(old.promise).resolves.toBe("old");
    const follower = scheduler.schedule(sharedRequest, followerExecute);

    expect(followerExecute).not.toHaveBeenCalled();
    freshRelease.resolve("fresh");
    await expect(Promise.all([fresh.promise, follower.promise])).resolves.toEqual(["fresh", "fresh"]);
    concurrentRelease.resolve("concurrent");
    await expect(concurrent.promise).resolves.toBe("concurrent");
    expect(followerExecute).not.toHaveBeenCalled();
  });

  it("keeps replacement capacity available after a fresh request fails", async () => {
    const scheduler = new CoordinatorRequestScheduler();
    const oldRelease = deferred<string>();
    const concurrentRelease = deferred<string>();
    const failedRelease = deferred<string>();
    const retryRelease = deferred<string>();
    const origin = "http://shared.onion";
    const sharedRequest = { ...request("shared", "visible"), key: "shared", origin };
    const oldExecute = vi.fn(async () => oldRelease.promise);
    const concurrentExecute = vi.fn(async () => concurrentRelease.promise);
    const old = scheduler.schedule(sharedRequest, oldExecute);
    const concurrent = scheduler.schedule(
      { ...request("concurrent", "visible"), origin },
      concurrentExecute
    );
    await vi.waitFor(() => {
      expect(oldExecute).toHaveBeenCalledOnce();
      expect(concurrentExecute).toHaveBeenCalledOnce();
    });

    const failedExecute = vi.fn(async () => failedRelease.promise);
    const failed = scheduler.schedule(
      { ...sharedRequest, supersedeInFlight: true },
      failedExecute
    );
    await vi.waitFor(() => expect(failedExecute).toHaveBeenCalledOnce());
    failedRelease.reject(new Error("fresh request failed"));
    await expect(failed.promise).rejects.toThrow("fresh request failed");

    const retryExecute = vi.fn(async () => retryRelease.promise);
    const retry = scheduler.schedule(sharedRequest, retryExecute);
    await vi.waitFor(() => expect(retryExecute).toHaveBeenCalledOnce());

    retryRelease.resolve("retry");
    await expect(retry.promise).resolves.toBe("retry");
    oldRelease.resolve("old");
    concurrentRelease.resolve("concurrent");
    await expect(Promise.all([old.promise, concurrent.promise])).resolves.toEqual(["old", "concurrent"]);
  });

  it("bounds same-origin supersession to one replacement slot", async () => {
    const scheduler = new CoordinatorRequestScheduler();
    const releases = Array.from({ length: 4 }, () => deferred<void>());
    const origin = "http://shared.onion";
    const sharedRequest = { ...request("shared", "visible"), key: "shared", origin };
    let active = 0;
    let maximum = 0;
    const execute = (index: number) => async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await releases[index].promise;
      active -= 1;
      return index;
    };

    const old = scheduler.schedule(sharedRequest, execute(0));
    const concurrent = scheduler.schedule({ ...request("concurrent", "visible"), origin }, execute(1));
    await vi.waitFor(() => expect(active).toBe(2));
    const fresh = scheduler.schedule({ ...sharedRequest, supersedeInFlight: true }, execute(2));
    await vi.waitFor(() => expect(active).toBe(3));

    const newestExecute = vi.fn(execute(3));
    const newest = scheduler.schedule({ ...sharedRequest, supersedeInFlight: true }, newestExecute);
    await Promise.resolve();
    expect(newestExecute).not.toHaveBeenCalled();

    releases[0].resolve();
    await vi.waitFor(() => expect(newestExecute).toHaveBeenCalledOnce());
    expect(maximum).toBe(3);
    releases[1].resolve();
    releases[2].resolve();
    releases[3].resolve();
    await expect(Promise.all([old.promise, concurrent.promise, fresh.promise, newest.promise])).resolves.toEqual([
      0, 1, 2, 3
    ]);
  });

  it("reuses a matching request that has not started when superseding", async () => {
    const scheduler = new CoordinatorRequestScheduler();
    const blockerRelease = deferred<void>();
    const origin = "http://shared.onion";
    const blockers = Array.from({ length: 2 }, (_, index) => scheduler.schedule(
      { ...request(`block-${index}`, "visible"), origin },
      async () => blockerRelease.promise
    ));
    await vi.waitFor(() => expect(scheduler.hasUserPriorityWork()).toBe(true));

    const queuedExecute = vi.fn(async () => "queued");
    const replacementExecute = vi.fn(async () => "replacement");
    const sharedRequest = { ...request("shared", "visible"), key: "shared", origin };
    const queued = scheduler.schedule(sharedRequest, queuedExecute);
    const replacement = scheduler.schedule(
      { ...sharedRequest, supersedeInFlight: true },
      replacementExecute
    );

    expect(queuedExecute).not.toHaveBeenCalled();
    expect(replacementExecute).not.toHaveBeenCalled();
    blockerRelease.resolve();
    await expect(Promise.all([queued.promise, replacement.promise])).resolves.toEqual(["queued", "queued"]);
    await Promise.all(blockers.map((blocker) => blocker.promise));
    expect(queuedExecute).toHaveBeenCalledOnce();
    expect(replacementExecute).not.toHaveBeenCalled();
  });

  it("aborts work at the scheduler timeout", async () => {
    vi.useFakeTimers();
    const scheduler = new CoordinatorRequestScheduler();
    const task = scheduler.schedule(
      { ...request("timeout", "background"), timeoutMs: 20_000 },
      (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    );

    const rejection = expect(task.promise).rejects.toThrow("Tor request timeout after 20000ms");
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    vi.useRealTimers();
  });

  it("does not coalesce requests with different keys", async () => {
    const scheduler = new CoordinatorRequestScheduler();
    const execute = vi.fn(async () => "ok");
    const first = scheduler.schedule({ ...request("one", "visible"), key: "one" }, execute);
    const second = scheduler.schedule({ ...request("two", "visible"), key: "two" }, execute);
    await Promise.all([first.promise, second.promise]);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("cancels queued work without executing it", async () => {
    vi.stubGlobal("window", { AndroidAppRobosats: { httpRequest: vi.fn() } });
    const scheduler = new CoordinatorRequestScheduler();
    const blockers = [deferred<void>(), deferred<void>()];
    const running = blockers.map((blocker, index) => scheduler.schedule(
      request(`block-${index}`, "background"),
      async () => blocker.promise
    ));
    const execute = vi.fn(async () => "unused");
    const queued = scheduler.schedule(request("queued", "background"), execute);
    queued.cancel();
    await expect(queued.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(execute).not.toHaveBeenCalled();
    blockers.forEach((blocker) => blocker.resolve());
    await Promise.all(running.map((task) => task.promise));
  });

  it("aborts in-flight work", async () => {
    const scheduler = new CoordinatorRequestScheduler();
    const task = scheduler.schedule(request("active", "visible"), (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
      })
    );
    task.cancel();
    await expect(task.promise).rejects.toMatchObject({ name: "AbortError" });
  });
});

function request(id: string, priority: "action" | "foreground" | "visible" | "background" | "maintenance") {
  return {
    origin: `http://${id}.onion`,
    method: "GET",
    priority,
    source: "manual" as const
  };
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
