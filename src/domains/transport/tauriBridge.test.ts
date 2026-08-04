import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke
}));

import {
  getDesktopTransportDiagnostics,
  isTauriDesktop,
  requestDesktopTorReconnect,
  requestDesktopTorReset,
  saveDesktopFile
} from "@/domains/transport/tauriBridge";

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

  it("invokes the destructive desktop Tor reset command explicitly", async () => {
    vi.stubGlobal("window", { RobosatsSettings: "desktop-basic" });
    mocks.invoke.mockResolvedValue(undefined);

    await requestDesktopTorReset();

    expect(mocks.invoke).toHaveBeenCalledWith("desktop_reset_transport", undefined);
  });

  it("routes exports to the desktop Downloads handler", async () => {
    vi.stubGlobal("window", { RobosatsSettings: "desktop-basic" });
    mocks.invoke.mockResolvedValue(undefined);

    await saveDesktopFile("trade.json", "{}");

    expect(mocks.invoke).toHaveBeenCalledWith("desktop_save_file", {
      filename: "trade.json",
      content: "{}"
    });
  });

  it("reads only structured desktop transport diagnostics", async () => {
    vi.stubGlobal("window", { RobosatsSettings: "desktop-basic" });
    mocks.invoke.mockResolvedValue([
      {
        phase: "tor-connect",
        outcome: "timeout",
        durationMs: 1200,
        attempt: 2,
        artiVersion: "0.1.0"
      }
    ]);

    await expect(getDesktopTransportDiagnostics()).resolves.toEqual([
      expect.objectContaining({ phase: "tor-connect", outcome: "timeout", attempt: 2 })
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith("desktop_transport_diagnostics", undefined);
  });
});
