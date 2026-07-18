import { afterEach, describe, expect, it, vi } from "vitest";
import { showDesktopOrderNotification } from "./desktopNotifications";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktop notifications", () => {
  it("sends an internal order notification to the desktop bridge", () => {
    const showNotification = vi.fn();
    vi.stubGlobal("window", {
      RoboSatsDesktop: { showNotification }
    });

    expect(showDesktopOrderNotification(90825, "temple-of-sats", "A taker has been found")).toBe(true);
    expect(showNotification).toHaveBeenCalledWith({
      title: "Order #90825",
      body: "A taker has been found",
      route: "/order/temple-of-sats/90825"
    });
  });

  it("rejects invalid order routes before crossing the desktop bridge", () => {
    const showNotification = vi.fn();
    vi.stubGlobal("window", {
      RoboSatsDesktop: { showNotification }
    });

    expect(showDesktopOrderNotification(90825, "../settings", "Update")).toBe(false);
    expect(showNotification).not.toHaveBeenCalled();
  });
});
