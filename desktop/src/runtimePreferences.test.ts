import { describe, expect, it } from "vitest";
import { isInternalOrderRoute, normalizeNotificationPayload } from "./runtimePreferences";

describe("desktop runtime input", () => {
  it("accepts only internal order routes for notification navigation", () => {
    expect(isInternalOrderRoute("/order/temple-of-sats/90825")).toBe(true);
    expect(isInternalOrderRoute("https://example.com/order/temple/90825")).toBe(false);
    expect(isInternalOrderRoute("/settings")).toBe(false);
  });

  it("trims notification text and drops unsafe routes", () => {
    expect(normalizeNotificationPayload({
      title: "  Order #90825  ",
      body: "  A taker has been found.  ",
      route: "https://example.com"
    })).toEqual({
      title: "Order #90825",
      body: "A taker has been found.",
      route: undefined
    });
  });
});
