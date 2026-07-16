import { describe, expect, it } from "vitest";
import { bondDisplayValue, expiryRingValue, formatExpiryCountdown, orderSatsPreview } from "@/domains/orderbook/offerDisplay";

describe("offerDisplay", () => {
  it("computes bond sats from percent when a coordinator omits bond_size_sats", () => {
    expect(bondDisplayValue({ bond_size_sats: 0, bond_size_percent: 3, satoshis: 419290 })).toMatchObject({
      sats: 12579,
      percent: 3,
      sortValue: 12579
    });
  });

  it("keeps percent-only bond display for Nostr orders without satoshi size", () => {
    expect(bondDisplayValue({ bond_size_sats: 0, bond_size_percent: 3, satoshis: 0 })).toMatchObject({
      sats: 0,
      percent: 3,
      sortValue: 3
    });
  });

  it("formats expiry countdowns", () => {
    const now = Date.parse("2026-07-06T10:00:00Z");
    expect(formatExpiryCountdown("2026-07-06T10:00:20Z", now)).toBe("1m");
    expect(formatExpiryCountdown("2026-07-06T12:05:00Z", now)).toBe("2h 05m");
    expect(formatExpiryCountdown("2026-07-08T13:00:00Z", now)).toBe("2d 3h");
    expect(formatExpiryCountdown("2026-07-06T09:59:59Z", now)).toBe("Expired");
  });

  it("formats old-style expiry ring values", () => {
    const now = Date.parse("2026-07-06T10:00:00Z");
    expect(expiryRingValue("2026-07-06T10:30:00Z", now)).toMatchObject({
      text: "30m",
      percent: 2,
      expired: false,
      tone: "danger"
    });
    expect(expiryRingValue("2026-07-06T15:00:00Z", now)).toMatchObject({
      text: "5h",
      percent: 21,
      expired: false,
      tone: "warning"
    });
    expect(expiryRingValue("2026-07-07T02:00:00Z", now)).toMatchObject({
      text: "16h",
      percent: 67,
      expired: false,
      tone: "success"
    });
    expect(expiryRingValue("2026-07-06T09:30:00Z", now)).toMatchObject({
      text: "30m",
      percent: 2,
      expired: true,
      tone: "danger"
    });
  });

  it("uses exact order sats before estimates", () => {
    expect(
      orderSatsPreview({
        amount: 100,
        currency: 840,
        has_range: false,
        max_amount: 0,
        premium: 10,
        satoshis: 150000,
        satoshis_now: 140000
      })
    ).toEqual({ approx: false, sats: 150000 });
  });

  it("uses coordinator satoshis_now when the API provides it", () => {
    expect(
      orderSatsPreview({
        amount: 100,
        currency: 840,
        has_range: false,
        max_amount: 0,
        premium: 10,
        satoshis: 0,
        satoshis_now: 140000
      })
    ).toEqual({ approx: true, sats: 140000 });
  });

  it("computes approximate sats from coordinator limits for Nostr orders", () => {
    expect(
      orderSatsPreview(
        {
          amount: 110,
          currency: 840,
          has_range: false,
          max_amount: 0,
          premium: 10,
          satoshis: 0
        },
        {
          840: {
            price: 110000
          }
        }
      )
    ).toEqual({ approx: true, sats: 90909 });
  });

  it("uses the selected range amount when taking a range order", () => {
    expect(
      orderSatsPreview(
        {
          amount: null,
          currency: 840,
          has_range: true,
          max_amount: 250,
          premium: 0,
          satoshis: 0,
          satoshis_now: 250000
        },
        {
          840: {
            price: 100000
          }
        },
        125
      )
    ).toEqual({ approx: true, sats: 125000 });
  });

  it("scales coordinator satoshis_now for selected range amounts when limits are missing", () => {
    expect(
      orderSatsPreview(
        {
          amount: null,
          currency: 840,
          has_range: true,
          max_amount: 200,
          premium: 0,
          satoshis: 0,
          satoshis_now: 180000
        },
        undefined,
        50
      )
    ).toEqual({ approx: true, sats: 45000 });
  });
});
