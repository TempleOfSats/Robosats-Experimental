import { beforeEach, describe, expect, it, vi } from "vitest";

const { transportRequestMock } = vi.hoisted(() => ({
  transportRequestMock: vi.fn()
}));

vi.mock("@/domains/transport/androidBridge", () => ({
  isAndroidApp: () => false,
  isIOSApp: () => false,
  transportRequest: transportRequestMock
}));

import { apiClient } from "@/domains/transport/apiWebClient";
import { coordinatorRequestScheduler } from "@/domains/transport/requestScheduler";

beforeEach(() => {
  transportRequestMock.mockReset();
  coordinatorRequestScheduler.resetForTests();
});

describe("ApiWebClient GET coalescing", () => {
  it("shares one transport request across background and interactive callers", async () => {
    let resolveTransport: ((value: {
      status: number;
      headers: Record<string, string>;
      body: string;
    }) => void) | undefined;
    transportRequestMock.mockReturnValue(new Promise((resolve) => {
      resolveTransport = resolve;
    }));
    const auth = { tokenSHA256: "robot-token-hash" };

    const background = apiClient.get("http://coordinator.onion", "/api/robot/", auth, {
      timeoutProfile: "background",
      priority: "background",
      source: "fleet-reconcile"
    });
    const interactive = apiClient.get("http://coordinator.onion", "/api/robot/", auth, {
      timeoutProfile: "interactive",
      priority: "visible",
      source: "robot-refresh"
    });

    await vi.waitFor(() => expect(transportRequestMock).toHaveBeenCalledOnce());
    resolveTransport?.({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"found":true}'
    });

    await expect(Promise.all([background, interactive])).resolves.toEqual([
      { found: true },
      { found: true }
    ]);
    expect(transportRequestMock).toHaveBeenCalledOnce();
  });
});
