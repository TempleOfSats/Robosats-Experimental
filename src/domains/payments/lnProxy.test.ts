import { describe, expect, it } from "vitest";
import { availableLnProxyServers } from "./lnProxy";

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
});
