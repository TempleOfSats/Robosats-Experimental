import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke
}));

import { isTauriDesktop, requestDesktopTorReconnect } from "@/domains/transport/tauriBridge";

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.invoke.mockReset();
});

describe("Tauri desktop detection", () => {
  it("uses the injected platform setting before the document root exists", () => {
    vi.stubGlobal("window", { RobosatsSettings: "desktop-basic" });

    expect(isTauriDesktop()).toBe(true);
  });

  it("does not identify browser builds as desktop", () => {
    vi.stubGlobal("window", { RobosatsSettings: "web-basic" });

    expect(isTauriDesktop()).toBe(false);
  });

  it("invokes the dedicated desktop Tor reconnect command", async () => {
    vi.stubGlobal("window", { RobosatsSettings: "desktop-basic" });
    mocks.invoke.mockResolvedValue(undefined);

    await requestDesktopTorReconnect();

    expect(mocks.invoke).toHaveBeenCalledWith("desktop_reconnect_transport", undefined);
  });
});
