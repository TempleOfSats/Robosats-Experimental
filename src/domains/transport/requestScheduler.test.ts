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

    await vi.waitFor(() => expect(started).toEqual(["a", "b", "action"]));
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
      { ...request("shared-visible", "visible"), key: "shared" },
      async () => { throw new Error("coalesced execution must not run"); }
    );

    blockers[0].resolve();
    await vi.waitFor(() => expect(started[2]).toBe("shared"));
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
