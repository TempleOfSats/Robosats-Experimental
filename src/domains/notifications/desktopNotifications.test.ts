import { beforeEach, describe, expect, it, vi } from "vitest";

const generateRobohashMock = vi.hoisted(() => vi.fn());
const { isTauriDesktopMock, showDesktopNotificationMock } = vi.hoisted(() => ({
  isTauriDesktopMock: vi.fn(() => true),
  showDesktopNotificationMock: vi.fn(() => Promise.resolve(true))
}));

vi.mock("@/domains/identity/roboidentitiesClient", () => ({
  generateRobohash: generateRobohashMock
}));
vi.mock("@/domains/transport/tauriBridge", () => ({
  isTauriDesktop: isTauriDesktopMock,
  showDesktopNotification: showDesktopNotificationMock
}));

import { showDesktopOrderNotification } from "@/domains/notifications/desktopNotifications";

beforeEach(() => {
  generateRobohashMock.mockReset();
  isTauriDesktopMock.mockReset();
  isTauriDesktopMock.mockReturnValue(true);
  showDesktopNotificationMock.mockClear();
  vi.stubGlobal(
    "Image",
    class {
      onload?: () => void;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
  );
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: () => "data:image/png;base64,iVBORw0KGgo="
    })
  });
});

describe("desktop order notifications", () => {
  it("skips avatar work outside the desktop runtime", async () => {
    isTauriDesktopMock.mockReturnValue(false);

    await expect(showDesktopOrderNotification(42, "temple", "Trade updated", "a".repeat(64))).resolves.toBe(false);

    expect(generateRobohashMock).not.toHaveBeenCalled();
    expect(showDesktopNotificationMock).not.toHaveBeenCalled();
  });

  it("attaches the robot avatar when it is available", async () => {
    const hashId = "a".repeat(64);
    generateRobohashMock.mockResolvedValue("data:image/svg+xml;base64,PHN2Zy8+");

    await expect(showDesktopOrderNotification(42, "temple", "Trade updated", hashId)).resolves.toBe(true);

    expect(generateRobohashMock).toHaveBeenCalledWith(hashId);
    expect(showDesktopNotificationMock).toHaveBeenCalledWith({
      title: "Order #42",
      body: "Trade updated",
      route: "/order/temple/42",
      avatar: { cacheKey: hashId, dataUrl: "data:image/png;base64,iVBORw0KGgo=" }
    });
  });

  it("still delivers the notification when avatar generation fails", async () => {
    generateRobohashMock.mockRejectedValue(new Error("avatar unavailable"));

    await expect(showDesktopOrderNotification(42, "temple", "Trade updated", "b".repeat(64))).resolves.toBe(true);

    expect(showDesktopNotificationMock).toHaveBeenCalledWith({
      title: "Order #42",
      body: "Trade updated",
      route: "/order/temple/42"
    });
  });

  it("does not retry a native notification that the bridge rejects", async () => {
    generateRobohashMock.mockResolvedValue("data:image/svg+xml;base64,PHN2Zy8+");
    showDesktopNotificationMock.mockRejectedValueOnce(new Error("native failure"));

    await expect(showDesktopOrderNotification(42, "temple", "Trade updated", "c".repeat(64))).resolves.toBe(false);

    expect(showDesktopNotificationMock).toHaveBeenCalledOnce();
  });
});
