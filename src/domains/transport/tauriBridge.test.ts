import { afterEach, describe, expect, it, vi } from "vitest";
import { isTauriDesktop } from "@/domains/transport/tauriBridge";

afterEach(() => {
  vi.unstubAllGlobals();
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
});
