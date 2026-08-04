import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("downloadTextFile", () => {
  it("uses the native save bridge for Android exports", async () => {
    const saveFile = vi.fn(() => true);
    vi.stubGlobal("window", { AndroidAppRobosats: { saveFile } });
    const { downloadTextFile } = await import("./downloadFile");

    downloadTextFile("trade.json", "héllo", "application/json");

    expect(saveFile).toHaveBeenCalledWith("trade.json", "application/json", "aMOpbGxv");
  });

  it("keeps a browser download alive long enough for WebKit", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    const anchor = { click: vi.fn(), remove: vi.fn() } as unknown as HTMLAnchorElement;
    const body = { appendChild: vi.fn() };
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
    vi.stubGlobal("window", { setTimeout });
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor), body });
    const { downloadTextFile } = await import("./downloadFile");

    downloadTextFile("trade.json", "{}", "application/json");

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(body.appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    vi.useRealTimers();
  });
});
