import { describe, expect, it } from "vitest";
import {
  cycleUnit,
  formatBtc,
  formatBtcContextual,
  formatBtcDecimal,
  formatFiat,
  formatSats
} from "./format";

describe("formatSats", () => {
  it("returns '0 sats' for null/undefined", () => {
    expect(formatSats(null)).toBe("0 sats");
    expect(formatSats(undefined)).toBe("0 sats");
    expect(formatSats(NaN)).toBe("0 sats");
  });

  it("formats with proper pluralization", () => {
    expect(formatSats(1)).toBe("1 sat");
    expect(formatSats(15000)).toBe("15,000 sats");
    expect(formatSats(100)).toBe("100 sats");
  });

  it("rounds to nearest integer", () => {
    expect(formatSats(1500.5)).toBe("1,501 sats");
  });
});

describe("formatFiat", () => {
  it("returns '0' for null/undefined", () => {
    expect(formatFiat(null)).toBe("0");
    expect(formatFiat(undefined)).toBe("0");
  });

  it("formats with currency", () => {
    expect(formatFiat(1234.56, "USD")).toBe("1,234.56 USD");
  });

  it("handles sub-cent values without rounding to $0.00", () => {
    const result = formatFiat(0.003, "USD");
    expect(result).not.toBe("$0.00 USD");
    expect(result).toContain("0.003");
  });

  it("handles zero", () => {
    expect(formatFiat(0, "USD")).toBe("0 USD");
  });
});

describe("formatBtc", () => {
  it("returns '₿0' for null/undefined", () => {
    expect(formatBtc(null)).toBe("₿0");
    expect(formatBtc(undefined)).toBe("₿0");
  });

  it("formats with ₿ symbol", () => {
    expect(formatBtc(15000)).toBe("₿15,000");
    expect(formatBtc(100000000)).toBe("₿100,000,000");
    expect(formatBtc(1)).toBe("₿1");
  });
});

describe("formatBtcDecimal", () => {
  it("returns '0 BTC' for null/undefined", () => {
    expect(formatBtcDecimal(null)).toBe("0 BTC");
    expect(formatBtcDecimal(undefined)).toBe("0 BTC");
  });

  it("formats as decimal BTC", () => {
    expect(formatBtcDecimal(15000)).toBe("0.00015 BTC");
    expect(formatBtcDecimal(100000000)).toBe("1 BTC");
  });
});

describe("formatBtcContextual", () => {
  it("defaults to sats", () => {
    expect(formatBtcContextual(15000)).toBe("15,000 sats");
  });

  it("formats as ₿ when unit is 'btc'", () => {
    expect(formatBtcContextual(15000, "btc")).toBe("₿15,000");
  });

  it("formats as fiat when unit is 'fiat' and rate provided", () => {
    // 15000 sats = 0.00015 BTC * 65000 USD/BTC = 9.75 USD
    const result = formatBtcContextual(15000, "fiat", "USD", 65000);
    expect(result).toContain("9.75");
    expect(result).toContain("USD");
  });

  it("returns currency-appropriate zero for fiat unit", () => {
    expect(formatBtcContextual(null, "fiat", "USD")).toBe("0 USD");
  });
});

describe("cycleUnit", () => {
  it("cycles sats → btc → fiat → sats", () => {
    expect(cycleUnit("sats", true)).toBe("btc");
    expect(cycleUnit("btc", true)).toBe("fiat");
    expect(cycleUnit("fiat", true)).toBe("sats");
  });

  it("skips fiat when no rate available", () => {
    expect(cycleUnit("btc", false)).toBe("sats");
  });
});
