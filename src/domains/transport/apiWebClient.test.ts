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
  it("keeps public GET requests CORS-safelisted", async () => {
    transportRequestMock.mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"online":true}'
    });

    await apiClient.get("http://coordinator.onion", "/api/info/");

    expect(transportRequestMock).toHaveBeenCalledWith(
      "http://coordinator.onion/api/info/",
      { method: "GET", headers: {} },
      90_000,
      expect.any(AbortSignal)
    );
  });

  it("sets the JSON content type for requests with JSON bodies", async () => {
    transportRequestMock.mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"created":true}'
    });

    await apiClient.post("http://coordinator.onion", "/api/make/", { amount: 100 });

    expect(transportRequestMock).toHaveBeenCalledWith(
      "http://coordinator.onion/api/make/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"amount":100}'
      },
      90_000,
      expect.any(AbortSignal)
    );
  });

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

  it("keeps a superseding GET independent and coalesces later callers onto it", async () => {
    type TransportResponse = {
      status: number;
      headers: Record<string, string>;
      body: string;
    };
    const resolvers: Array<(value: TransportResponse) => void> = [];
    transportRequestMock.mockImplementation(
      () =>
        new Promise<TransportResponse>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const auth = { tokenSHA256: "robot-token-hash" };

    const old = apiClient.get("http://coordinator.onion", "/api/order/?order_id=42", auth);
    await vi.waitFor(() => expect(transportRequestMock).toHaveBeenCalledOnce());
    const fresh = apiClient.get("http://coordinator.onion", "/api/order/?order_id=42", auth, {
      supersedeInFlight: true
    });
    await vi.waitFor(() => expect(transportRequestMock).toHaveBeenCalledTimes(2));

    resolvers[0]({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"version":"old"}'
    });
    await expect(old).resolves.toEqual({ version: "old" });
    const follower = apiClient.get("http://coordinator.onion", "/api/order/?order_id=42", auth);

    expect(transportRequestMock).toHaveBeenCalledTimes(2);
    resolvers[1]({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"version":"fresh"}'
    });
    await expect(Promise.all([fresh, follower])).resolves.toEqual([
      { version: "fresh" },
      { version: "fresh" }
    ]);
    expect(transportRequestMock).toHaveBeenCalledTimes(2);
  });
});
