export type FiatUnit = "btc" | "sats" | "fiat";

export function formatSats(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "0 sats";
  const rounded = Math.round(value);
  const formatted = new Intl.NumberFormat().format(rounded);
  try {
    const pluralRules = new Intl.PluralRules();
    const unit = pluralRules.select(rounded) === "one" ? "sat" : "sats";
    return `${formatted} ${unit}`;
  } catch {
    return `${formatted} sats`;
  }
}

export function formatFiat(value?: number | null, currency = ""): string {
  if (value == null || Number.isNaN(value)) return currency ? `0 ${currency}` : "0";

  const absValue = Math.abs(value);
  if (absValue < 0.01 && absValue > 0) {
    const formatted = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 8,
      minimumFractionDigits: 0
    }).format(value);
    return currency ? `${formatted} ${currency}` : formatted;
  }

  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(value)}${currency ? ` ${currency}` : ""}`;
}

export function formatBtc(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "₿0";
  const sats = Math.round(value);
  const formatted = new Intl.NumberFormat().format(sats);
  return `₿${formatted}`;
}

export function formatBtcDecimal(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "0 BTC";
  const btc = value / 100_000_000;
  return `${btc.toFixed(8).replace(/\.?0+$/, "")} BTC`;
}

export function formatBtcContextual(
  value?: number | null,
  unit: FiatUnit = "sats",
  currency = "",
  fiatRate?: number
): string {
  if (value == null || Number.isNaN(value)) {
    if (unit === "fiat" && currency) return `0 ${currency}`;
    if (unit === "btc") return "₿0";
    return "0 sats";
  }

  switch (unit) {
    case "fiat":
      if (fiatRate && fiatRate > 0) {
        return formatFiat((value / 100_000_000) * fiatRate, currency);
      }
      return formatFiat(value, currency);
    case "btc":
      return formatBtc(value);
    case "sats":
    default:
      return formatSats(value);
  }
}

export function cycleUnit(current: FiatUnit, hasFiatRate: boolean): FiatUnit {
  if (current === "sats") return "btc";
  if (current === "btc") return hasFiatRate ? "fiat" : "sats";
  return "sats";
}

export function truncateMiddle(value: string, visible = 8): string {
  if (value.length <= visible * 2 + 3) return value;
  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
}
