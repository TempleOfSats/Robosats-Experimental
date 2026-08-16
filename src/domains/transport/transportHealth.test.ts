import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transportRequest: vi.fn(),
  recoverDesktop: vi.fn()
}));

vi.mock("@/domains/transport/androidBridge", () => ({
  transportRequest: mocks.transportRequest
}));
vi.mock("@/domains/transport/tauriBridge", () => ({
  requestDesktopTransportRecovery: mocks.recoverDesktop
}));

import {
  noteTransportFailure,
  resetTransportHealthForTests,
  setTransportHealthActive,
  setTransportProbeOrigins,
  waitForTransportHealthIdleForTests
} from "@/domains/transport/transportHealth";

describe("transport health", () => {
  beforeEach(() => {
    resetTransportHealthForTests();
    mocks.transportRequest.mockReset();
    mocks.recoverDesktop.mockReset();
    vi.stubGlobal("window", {});
    setTransportProbeOrigins(["https://one.example", "https://two.example"]);
  });

  it("does not probe after one coordinator fails", async () => {
    noteTransportFailure("https://one.example", "timeout");
    await waitForTransportHealthIdleForTests();
    expect(mocks.transportRequest).not.toHaveBeenCalled();
  });

  it("uses a successful independent probe instead of restarting Tor", async () => {
    mocks.transportRequest.mockResolvedValue({ status: 500, headers: {}, body: "" });
    noteTransportFailure("https://one.example", "timeout");
    noteTransportFailure("https://two.example", "connect");
    await waitForTransportHealthIdleForTests();
    expect(mocks.transportRequest).toHaveBeenCalledTimes(1);
    expect(mocks.recoverDesktop).not.toHaveBeenCalled();
  });

  it("requests one controlled recovery when both probes fail", async () => {
    mocks.transportRequest.mockRejectedValue(new Error("offline"));
    noteTransportFailure("https://one.example", "timeout");
    noteTransportFailure("https://two.example", "connect");
    await waitForTransportHealthIdleForTests();
    expect(mocks.transportRequest).toHaveBeenCalledTimes(2);
    expect(mocks.recoverDesktop).toHaveBeenCalledTimes(1);
  });

  it("does not recover from a probe started before suspension", async () => {
    mocks.transportRequest.mockImplementation(
      (_url: string, _init: RequestInit, _timeoutMs: number, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        })
    );
    noteTransportFailure("https://one.example", "timeout");
    noteTransportFailure("https://two.example", "connect");
    await vi.waitFor(() => expect(mocks.transportRequest).toHaveBeenCalledOnce());

    setTransportHealthActive(false);
    await vi.waitFor(() => expect(mocks.recoverDesktop).not.toHaveBeenCalled());
  });

  it("requires two fresh failures after resuming", async () => {
    noteTransportFailure("https://one.example", "timeout");
    setTransportHealthActive(false);
    setTransportHealthActive(true);

    noteTransportFailure("https://two.example", "connect");
    await waitForTransportHealthIdleForTests();
    expect(mocks.transportRequest).not.toHaveBeenCalled();

    mocks.transportRequest.mockRejectedValue(new Error("offline"));
    noteTransportFailure("https://one.example", "timeout");
    await waitForTransportHealthIdleForTests();
    expect(mocks.transportRequest).toHaveBeenCalledTimes(2);
    expect(mocks.recoverDesktop).toHaveBeenCalledOnce();
  });

  it("does not let an old probe completion clear a current probe", async () => {
    const oldProbe = deferred<void>();
    const currentProbe = deferred<void>();
    mocks.transportRequest
      .mockImplementationOnce(() => oldProbe.promise)
      .mockImplementationOnce(() => currentProbe.promise)
      .mockRejectedValue(new Error("offline"));
    noteTransportFailure("https://one.example", "timeout");
    noteTransportFailure("https://two.example", "connect");
    await vi.waitFor(() => expect(mocks.transportRequest).toHaveBeenCalledOnce());

    setTransportHealthActive(false);
    setTransportHealthActive(true);
    noteTransportFailure("https://one.example", "timeout");
    noteTransportFailure("https://two.example", "connect");
    await vi.waitFor(() => expect(mocks.transportRequest).toHaveBeenCalledTimes(2));

    oldProbe.resolve();
    await Promise.resolve();
    noteTransportFailure("https://one.example", "timeout");
    expect(mocks.transportRequest).toHaveBeenCalledTimes(2);

    currentProbe.reject(new Error("offline"));
    await waitForTransportHealthIdleForTests();
    expect(mocks.transportRequest).toHaveBeenCalledTimes(3);
    expect(mocks.recoverDesktop).toHaveBeenCalledOnce();
  });
});

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
