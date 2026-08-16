import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAndroidApp: vi.fn(() => true),
  isNativeApp: vi.fn(() => true),
  resumeNativeTransport: vi.fn(),
  setTransportHealthActive: vi.fn(),
  suspendNativeTransport: vi.fn(),
  schedulerResume: vi.fn(),
  schedulerSuspend: vi.fn()
}));

vi.mock("@/domains/transport/androidBridge", () => ({
  isAndroidApp: mocks.isAndroidApp,
  isNativeApp: mocks.isNativeApp,
  resumeNativeTransport: mocks.resumeNativeTransport,
  suspendNativeTransport: mocks.suspendNativeTransport
}));
vi.mock("@/domains/transport/requestScheduler", () => ({
  coordinatorRequestScheduler: {
    resume: mocks.schedulerResume,
    suspend: mocks.schedulerSuspend
  }
}));
vi.mock("@/domains/transport/transportHealth", () => ({
  setTransportHealthActive: mocks.setTransportHealthActive
}));

import {
  installNativeTransportLifecycle,
  resetNativeTransportLifecycleForTests
} from "@/domains/transport/nativeTransportLifecycle";

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(mocks).forEach((mock) => mock.mockClear());
  mocks.isAndroidApp.mockReturnValue(true);
  mocks.isNativeApp.mockReturnValue(true);
});

afterEach(() => {
  resetNativeTransportLifecycleForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("native transport lifecycle", () => {
  it("suspends mobile transport while hidden and resumes it when visible", async () => {
    const { documentTarget } = lifecycleHarness("visible");
    installNativeTransportLifecycle();

    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));

    expect(mocks.setTransportHealthActive).toHaveBeenCalledWith(false);
    expect(mocks.schedulerSuspend).toHaveBeenCalledWith("App backgrounded");
    expect(mocks.suspendNativeTransport).toHaveBeenCalledWith("App backgrounded");

    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.resumeNativeTransport).toHaveBeenCalledOnce();
    expect(mocks.setTransportHealthActive).toHaveBeenLastCalledWith(true);
    expect(mocks.schedulerResume).toHaveBeenCalledOnce();
  });

  it("uses the Android resume event even before visibility catches up", () => {
    const { documentTarget, windowTarget } = lifecycleHarness("visible");
    installNativeTransportLifecycle();
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));

    windowTarget.dispatchEvent(new Event("robosats:native-resume"));

    expect(mocks.resumeNativeTransport).toHaveBeenCalledOnce();
    expect(mocks.schedulerResume).toHaveBeenCalledOnce();
  });

  it("does not resume hidden iOS work on a Tor connected event", () => {
    const { windowTarget } = lifecycleHarness("hidden");
    mocks.isAndroidApp.mockReturnValue(false);
    installNativeTransportLifecycle();

    windowTarget.dispatchEvent(new Event("robosats:native-resume"));

    expect(mocks.resumeNativeTransport).not.toHaveBeenCalled();
    expect(mocks.schedulerResume).not.toHaveBeenCalled();
  });

  it("starts suspended when the native document is already hidden", () => {
    lifecycleHarness("hidden");

    installNativeTransportLifecycle();

    expect(mocks.setTransportHealthActive).toHaveBeenCalledWith(false);
    expect(mocks.schedulerSuspend).toHaveBeenCalledWith("App backgrounded");
    expect(mocks.suspendNativeTransport).toHaveBeenCalledWith("App backgrounded");
  });

  it("does not install lifecycle suspension in the browser", () => {
    const { documentTarget } = lifecycleHarness("visible");
    mocks.isNativeApp.mockReturnValue(false);
    installNativeTransportLifecycle();

    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));

    expect(mocks.suspendNativeTransport).not.toHaveBeenCalled();
    expect(mocks.schedulerSuspend).not.toHaveBeenCalled();
  });
});

function lifecycleHarness(initialVisibility: DocumentVisibilityState) {
  const windowTarget = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  });
  const documentTarget = Object.assign(new EventTarget(), {
    visibilityState: initialVisibility
  });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  return { documentTarget, windowTarget };
}
