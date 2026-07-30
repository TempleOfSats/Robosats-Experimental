import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginRouteTransition,
  isMatchingRouteTransition,
  isStandardGarageRoute
} from "@/domains/navigation/routeTransition";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("standard Garage route detection", () => {
  it("matches the Garage route and nested Garage paths", () => {
    expect(isStandardGarageRoute("/garage")).toBe(true);
    expect(isStandardGarageRoute("/garage/robot")).toBe(true);
    expect(isStandardGarageRoute("#/garage")).toBe(true);
  });

  it("does not treat Pro Desk or similarly named routes as the standard Garage", () => {
    expect(isStandardGarageRoute("/pro")).toBe(false);
    expect(isStandardGarageRoute("/garage-tools")).toBe(false);
  });
});

describe("route transition feedback", () => {
  it("clears feedback only when the route that became ready is still pending", () => {
    expect(isMatchingRouteTransition("/offers", "#/offers?currency=USD")).toBe(true);
    expect(isMatchingRouteTransition("/settings", "/offers")).toBe(false);
  });

  it("does not prevent navigation callers when feedback dispatch is unavailable", () => {
    vi.stubGlobal("window", {
      dispatchEvent: () => {
        throw new Error("events unavailable");
      },
      location: { href: "http://localhost/offers" }
    });

    expect(() => beginRouteTransition("/order/lake/123")).not.toThrow();
  });
});
