import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const diagnosticsMock = vi.hoisted(() => vi.fn());

vi.mock("@/domains/transport/androidBridge", () => ({
  getNativeTorDiagnostics: diagnosticsMock,
  isNativeApp: vi.fn(() => true),
  nativeAppBridge: vi.fn(),
  requestNativeTorReconnect: vi.fn(),
  requestNativeTorReset: vi.fn()
}));

vi.mock("@/domains/transport/tauriBridge", () => ({
  getDesktopTorDiagnostics: vi.fn(),
  isTauriDesktop: vi.fn(() => false),
  requestDesktopTorReconnect: vi.fn(),
  requestDesktopTorReset: vi.fn()
}));

import { registerTorReconnectMonitor } from "@/domains/transport/torConnection";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  });
  diagnosticsMock.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Tor reconnect monitor", () => {
  it("reports a failed reconnect after observing the attempt", async () => {
    diagnosticsMock.mockReturnValueOnce(diagnostics("connecting")).mockReturnValueOnce(diagnostics("failed"));
    const onFailed = vi.fn();
    const stop = registerTorReconnectMonitor({
      desktopRuntime: false,
      intervalMs: 100,
      onDiagnostics: vi.fn(),
      onFailed,
      onReconnected: vi.fn(),
      onUnconfirmed: vi.fn()
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(onFailed).toHaveBeenCalledOnce();
    stop();
  });

  it("publishes success when diagnostics recover without a native event", async () => {
    diagnosticsMock.mockReturnValueOnce(diagnostics("connecting")).mockReturnValueOnce(diagnostics("connected"));
    const onReconnected = vi.fn();
    const stop = registerTorReconnectMonitor({
      desktopRuntime: false,
      intervalMs: 100,
      onDiagnostics: vi.fn(),
      onFailed: vi.fn(),
      onReconnected,
      onUnconfirmed: vi.fn()
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(onReconnected).toHaveBeenCalledOnce();
    stop();
  });

  it("fails cleanly when native diagnostics never show a rebuild", async () => {
    diagnosticsMock.mockReturnValue(diagnostics("connected"));
    const onReconnected = vi.fn();
    const onUnconfirmed = vi.fn();
    const stop = registerTorReconnectMonitor({
      desktopRuntime: false,
      intervalMs: 100,
      onDiagnostics: vi.fn(),
      onFailed: vi.fn(),
      onReconnected,
      onUnconfirmed,
      transitionTimeoutMs: 300
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(onReconnected).not.toHaveBeenCalled();
    expect(onUnconfirmed).toHaveBeenCalledOnce();
    stop();
  });

  it("bounds a reconnect that remains in progress", async () => {
    diagnosticsMock.mockReturnValue(diagnostics("connecting"));
    const onUnconfirmed = vi.fn();
    const stop = registerTorReconnectMonitor({
      completionTimeoutMs: 300,
      desktopRuntime: false,
      intervalMs: 100,
      onDiagnostics: vi.fn(),
      onFailed: vi.fn(),
      onReconnected: vi.fn(),
      onUnconfirmed,
      transitionTimeoutMs: 50
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(onUnconfirmed).toHaveBeenCalledOnce();
    stop();
  });

  it("ignores a late diagnostics result after disposal", async () => {
    let resolve!: (value: ReturnType<typeof diagnostics>) => void;
    diagnosticsMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const onDiagnostics = vi.fn();
    const stop = registerTorReconnectMonitor({
      desktopRuntime: false,
      intervalMs: 100,
      onDiagnostics,
      onFailed: vi.fn(),
      onReconnected: vi.fn(),
      onUnconfirmed: vi.fn()
    });

    stop();
    resolve(diagnostics("connected"));
    await vi.advanceTimersByTimeAsync(100);

    expect(onDiagnostics).not.toHaveBeenCalled();
  });
});

function diagnostics(state: "connected" | "connecting" | "failed") {
  return {
    connected: state === "connected",
    state,
    socksHost: "127.0.0.1",
    socksPort: 19050,
    implementation: "Arti",
    artiVersion: "test",
    bootstrapProgress: state === "connected" ? 100 : 20,
    clientInitialized: true,
    proxyRunning: state === "connected",
    networkAvailable: true,
    routing: "Native Tor",
    appVersion: "test",
    error: state === "failed" ? "failed" : null
  } as const;
}
