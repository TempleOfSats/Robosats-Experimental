import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transportRequest: vi.fn(),
  recoverDesktop: vi.fn()
}));

vi.mock("@/domains/transport/androidBridge", () => ({
  transportRequest: mocks.transportRequest
}));
vi.mock("@/domains/transport/tauriBridge", () => ({
  requestDesktopTransportRecovery: mocks.recoverDesktop
}));

import {
  noteTransportFailure,
  resetTransportHealthForTests,
  setTransportProbeOrigins,
  waitForTransportHealthIdleForTests
} from "@/domains/transport/transportHealth";

describe("transport health", () => {
  beforeEach(() => {
    resetTransportHealthForTests();
    mocks.transportRequest.mockReset();
    mocks.recoverDesktop.mockReset();
    vi.stubGlobal("window", {});
    setTransportProbeOrigins(["https://one.example", "https://two.example"]);
  });

  it("does not probe after one coordinator fails", async () => {
    noteTransportFailure("https://one.example", "timeout");
    await waitForTransportHealthIdleForTests();
    expect(mocks.transportRequest).not.toHaveBeenCalled();
  });

  it("uses a successful independent probe instead of restarting Tor", async () => {
    mocks.transportRequest.mockResolvedValue({ status: 500, headers: {}, body: "" });
    noteTransportFailure("https://one.example", "timeout");
    noteTransportFailure("https://two.example", "connect");
    await waitForTransportHealthIdleForTests();
    expect(mocks.transportRequest).toHaveBeenCalledTimes(1);
    expect(mocks.recoverDesktop).not.toHaveBeenCalled();
  });

  it("requests one controlled recovery when both probes fail", async () => {
    mocks.transportRequest.mockRejectedValue(new Error("offline"));
    noteTransportFailure("https://one.example", "timeout");
    noteTransportFailure("https://two.example", "connect");
    await waitForTransportHealthIdleForTests();
    expect(mocks.transportRequest).toHaveBeenCalledTimes(2);
    expect(mocks.recoverDesktop).toHaveBeenCalledTimes(1);
  });
});
