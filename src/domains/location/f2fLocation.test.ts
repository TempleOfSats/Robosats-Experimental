import { describe, expect, it } from "vitest";
import {
  approximateF2FLocation,
  decodeGeohashCenter,
  formatApproximateF2FLocation,
  hasApproximateF2FLocation,
  isCashF2FMethod,
  paymentMethodHasF2F
} from "@/domains/location/f2fLocation";

describe("F2F location helpers", () => {
  it("recognizes Cash F2F in single and mixed payment methods", () => {
    expect(isCashF2FMethod("Cash F2F")).toBe(true);
    expect(paymentMethodHasF2F("Revolut, Cash F2F")).toBe(true);
    expect(paymentMethodHasF2F("CashApp")).toBe(false);
  });

  it("discards precise coordinate digits using the legacy-sized approximation", () => {
    expect(approximateF2FLocation(35.689487, 139.691711)).toEqual([35.7, 139.7]);
    expect(formatApproximateF2FLocation(35.7, -139.7)).toBe("35.7°N, 139.7°W");
  });

  it("treats the draft origin sentinel as unset", () => {
    expect(hasApproximateF2FLocation(0, 0)).toBe(false);
    expect(hasApproximateF2FLocation(-34.6, -58.4)).toBe(true);
  });

  it("decodes the center represented by a Nostr geohash tag", () => {
    const decoded = decodeGeohashCenter("xn774");
    expect(decoded?.[0]).toBeCloseTo(35.7, 0);
    expect(decoded?.[1]).toBeCloseTo(139.7, 0);
    expect(decodeGeohashCenter("not-valid!")).toBeUndefined();
  });
});
