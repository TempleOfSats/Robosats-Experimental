import { beforeEach, describe, expect, it, vi } from "vitest";

const transportRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/domains/transport/androidBridge", () => ({
  isNativeApp: () => false,
  transportRequest: transportRequestMock
}));

import { availableLnProxyServers, wrapLnProxyInvoice, type LnProxyServer } from "./lnProxy";

beforeEach(() => {
  transportRequestMock.mockReset();
});

describe("availableLnProxyServers", () => {
  it("uses onion LNProxy servers in the Android Arti runtime", () => {
    const servers = availableLnProxyServers("appassets.androidplatform.net", true);

    expect(servers).toHaveLength(2);
    expect(servers.every((server) => server.url.includes(".onion"))).toBe(true);
  });

  it("retains clearnet selection for an ordinary clearnet browser", () => {
    expect(availableLnProxyServers("robosats.example.org", false)).toEqual([
      expect.objectContaining({ relayType: "Clearnet" })
    ]);
  });

  it("returns a stable error for malformed successful responses", async () => {
    transportRequestMock.mockResolvedValue({ body: "not-json", headers: {}, status: 200 });

    await expect(wrapLnProxyInvoice(server, "fixture-invoice", 0)).rejects.toThrow(
      "LNProxy returned an invalid response."
    );
  });

  it("preserves the HTTP status when an error response is malformed", async () => {
    transportRequestMock.mockResolvedValue({ body: "not-json", headers: {}, status: 503 });

    await expect(wrapLnProxyInvoice(server, "fixture-invoice", 0)).rejects.toThrow("LNProxy returned HTTP 503");
  });

  it.each([JSON.stringify({ proxy_invoice: "   " }), JSON.stringify({ proxy_invoice: 42 }), JSON.stringify([])])(
    "rejects a successful response without a usable proxy invoice",
    async (body) => {
      transportRequestMock.mockResolvedValue({ body, headers: {}, status: 200 });

      await expect(wrapLnProxyInvoice(server, "fixture-invoice", 0)).rejects.toThrow(
        "LNProxy returned an invalid response."
      );
    }
  );

  it("returns a valid proxy invoice", async () => {
    transportRequestMock.mockResolvedValue({
      body: JSON.stringify({ proxy_invoice: "  fixture-proxy-invoice  " }),
      headers: {},
      status: 200
    });

    await expect(wrapLnProxyInvoice(server, "fixture-invoice", 12)).resolves.toBe("fixture-proxy-invoice");
  });
});

const server: LnProxyServer = {
  name: "Fixture LNProxy",
  network: "mainnet",
  relayType: "Clearnet",
  url: "https://lnproxy.example/spec"
};
