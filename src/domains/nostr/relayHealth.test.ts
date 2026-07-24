import { beforeEach, describe, expect, it } from "vitest";
import {
  isRelayLiveHealthy,
  noteRelayConnected,
  noteRelayDisconnected,
  noteRelayEose,
  noteRelayFailure,
  noteRelaySuccess,
  orderRelays,
  relayHealthSnapshot,
  resetRelayHealthForTests
} from "@/domains/nostr/relayHealth";

describe("relay health", () => {
  beforeEach(resetRelayHealthForTests);

  it("normalizes equivalent relay URLs", () => {
    noteRelayFailure("WSS://RELAY.EXAMPLE/relay/");
    expect(relayHealthSnapshot("wss://relay.example/relay")?.failures).toBe(1);
  });

  it("orders a successful relay before a failing relay", () => {
    noteRelayFailure("wss://slow.example");
    noteRelayFailure("wss://slow.example");
    noteRelaySuccess("wss://fast.example", 50);
    expect(orderRelays(["wss://slow.example", "wss://fast.example"])[0]).toBe("wss://fast.example");
  });

  it("tracks live health separately from historical success", () => {
    noteRelayConnected("wss://relay.example");
    noteRelayEose("wss://relay.example", 100);
    expect(isRelayLiveHealthy("wss://relay.example")).toBe(true);
    noteRelayDisconnected("wss://relay.example");
    expect(isRelayLiveHealthy("wss://relay.example")).toBe(false);
  });
});
