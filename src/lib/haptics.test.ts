// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { playHaptic } from "@/lib/haptics";

afterEach(() => {
  delete window.AndroidAppRobosats;
  delete window.IOSAppRobosats;
});

describe("playHaptic", () => {
  it("forwards semantic feedback to the active native shell", () => {
    const performHaptic = vi.fn();
    window.AndroidAppRobosats = { performHaptic } as unknown as RoboSatsNativeBridge;

    playHaptic("selection");
    playHaptic("commit");
    playHaptic("success");
    playHaptic("reject");

    expect(performHaptic.mock.calls).toEqual([["selection"], ["commit"], ["success"], ["reject"]]);
  });

  it("is a safe no-op when haptics are unsupported or the native bridge fails", () => {
    expect(() => playHaptic("commit")).not.toThrow();
    window.IOSAppRobosats = {
      performHaptic: vi.fn(() => {
        throw new Error("unavailable");
      })
    } as unknown as RoboSatsNativeBridge;
    expect(() => playHaptic("success")).not.toThrow();
  });
});
