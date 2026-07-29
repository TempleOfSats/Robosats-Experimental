import { currencyCodeFromId } from "@/domains/orderbook/currencies";

export type CompletedInterval = "day" | "week" | "month" | "year";
export type ActivityInterval = "ten-minutes" | "hour" | "day";

export type CompletedVolumeRecord = {
  contracts: number;
  coordinator: string;
  date: string;
  volumeBtc: number;
};

export type MarketTick = {
  coordinator: string;
  currency?: number;
  fee: number;
  premium?: number;
  price?: number;
  timestamp: string;
  volumeBtc?: number;
};

export type ChartPoint = {
  contracts: number;
  key: string;
  label: string;
  volumeBtc: number;
};

export type MarketComparison = {
  activity: number;
  averagePremium?: number;
  currency: string;
  volumeBtc: number;
};

type HistoricalEntry = {
  num_contracts?: unknown;
  volume?: unknown;
};

type TickEntry = {
  currency?: unknown;
  fee?: unknown;
  premium?: unknown;
  price?: unknown;
  timestamp?: unknown;
  volume?: unknown;
};

const COMPLETED_LIMITS: Record<CompletedInterval, number> = {
  day: 90,
  week: 52,
  month: 24,
  year: 8
};

const ACTIVITY_LIMITS: Record<ActivityInterval, number> = {
  "ten-minutes": 48,
  hour: 48,
  day: 30
};

export function normalizeHistoricalPayload(payload: unknown, coordinator: string): CompletedVolumeRecord[] {
  const containers = Array.isArray(payload) ? payload : [payload];
  const records: CompletedVolumeRecord[] = [];

  for (const container of containers) {
    if (!isRecord(container)) continue;
    for (const [date, rawEntry] of Object.entries(container)) {
      if (!isDateKey(date) || !isRecord(rawEntry)) continue;
      const entry = rawEntry as HistoricalEntry;
      const volumeBtc = finiteNumber(entry.volume);
      const contracts = finiteNumber(entry.num_contracts);
      if (volumeBtc === undefined || contracts === undefined) continue;
      records.push({
        contracts: Math.max(0, Math.trunc(contracts)),
        coordinator,
        date: date.slice(0, 10),
        volumeBtc: Math.max(0, volumeBtc)
      });
    }
  }

  return records.sort((left, right) => left.date.localeCompare(right.date));
}

export function normalizeTicksPayload(payload: unknown, coordinator: string): MarketTick[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((raw): MarketTick[] => {
    if (!isRecord(raw) || typeof raw.timestamp !== "string" || !Number.isFinite(Date.parse(raw.timestamp))) return [];
    const entry = raw as TickEntry;
    const currency = finiteNumber(entry.currency);
    const price = finiteNumber(entry.price);
    const premium = finiteNumber(entry.premium);
    const volumeBtc = finiteNumber(entry.volume);
    return [{
      coordinator,
      timestamp: raw.timestamp,
      fee: finiteNumber(entry.fee) ?? 0,
      ...(currency === undefined ? {} : { currency: Math.trunc(currency) }),
      ...(price === undefined ? {} : { price }),
      ...(premium === undefined ? {} : { premium }),
      ...(volumeBtc === undefined ? {} : { volumeBtc: Math.max(0, volumeBtc) })
    }];
  }).sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

export function completedVolumeSeries(
  records: CompletedVolumeRecord[],
  interval: CompletedInterval,
  now = new Date()
): ChartPoint[] {
  const totals = new Map<string, { contracts: number; volumeBtc: number }>();
  for (const record of records) {
    const date = parseUtcDate(record.date);
    if (!date) continue;
    const key = periodKey(date, interval);
    const current = totals.get(key) ?? { contracts: 0, volumeBtc: 0 };
    current.contracts += record.contracts;
    current.volumeBtc += record.volumeBtc;
    totals.set(key, current);
  }

  return periodSequence(interval, COMPLETED_LIMITS[interval], now).map((date) => {
    const key = periodKey(date, interval);
    const total = totals.get(key) ?? { contracts: 0, volumeBtc: 0 };
    return { ...total, key, label: periodLabel(date, interval) };
  });
}

export function activityVolumeSeries(
  ticks: MarketTick[],
  interval: ActivityInterval,
  now = new Date()
): ChartPoint[] {
  const totals = new Map<string, { contracts: number; volumeBtc: number }>();
  for (const tick of ticks) {
    const date = new Date(tick.timestamp);
    if (!Number.isFinite(date.getTime())) continue;
    const key = activityPeriodKey(date, interval);
    const current = totals.get(key) ?? { contracts: 0, volumeBtc: 0 };
    current.contracts += 1;
    current.volumeBtc += tick.volumeBtc ?? 0;
    totals.set(key, current);
  }

  return activityPeriodSequence(interval, ACTIVITY_LIMITS[interval], now).map((date) => {
    const key = activityPeriodKey(date, interval);
    const total = totals.get(key) ?? { contracts: 0, volumeBtc: 0 };
    return { ...total, key, label: activityPeriodLabel(date, interval) };
  });
}

export function tickCurrencyCode(tick: MarketTick): string {
  if (tick.currency === undefined) return "Unknown";
  return currencyCodeFromId(tick.currency) ?? `#${tick.currency}`;
}

export function tickFiatAmount(tick: MarketTick): number | undefined {
  if (tick.price === undefined || tick.volumeBtc === undefined) return undefined;
  return tick.price * tick.volumeBtc;
}

export function volumeWeightedPremium(ticks: MarketTick[]): number | undefined {
  let weightedPremium = 0;
  let weight = 0;
  for (const tick of ticks) {
    if (tick.premium === undefined || !tick.volumeBtc || tick.volumeBtc <= 0) continue;
    weightedPremium += tick.premium * tick.volumeBtc;
    weight += tick.volumeBtc;
  }
  return weight > 0 ? weightedPremium / weight : undefined;
}

export function marketActivityComparisons(ticks: MarketTick[]): MarketComparison[] {
  const grouped = new Map<string, MarketTick[]>();
  for (const tick of ticks) {
    const currency = tickCurrencyCode(tick);
    if (currency === "Unknown" || currency.startsWith("#")) continue;
    grouped.set(currency, [...(grouped.get(currency) ?? []), tick]);
  }

  return [...grouped.entries()].map(([currency, records]) => ({
    activity: records.length,
    averagePremium: volumeWeightedPremium(records),
    currency,
    volumeBtc: records.reduce((total, record) => total + (record.volumeBtc ?? 0), 0)
  })).sort((left, right) => right.volumeBtc - left.volumeBtc || right.activity - left.activity);
}

function periodSequence(interval: CompletedInterval, count: number, now: Date): Date[] {
  const end = periodStart(now, interval);
  return Array.from({ length: count }, (_, index) => shiftPeriod(end, interval, index - count + 1));
}

function activityPeriodSequence(interval: ActivityInterval, count: number, now: Date): Date[] {
  const end = activityPeriodStart(now, interval);
  return Array.from({ length: count }, (_, index) => shiftActivityPeriod(end, interval, index - count + 1));
}

function periodStart(date: Date, interval: CompletedInterval): Date {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (interval === "week") next.setUTCDate(next.getUTCDate() - ((next.getUTCDay() + 6) % 7));
  if (interval === "month") next.setUTCDate(1);
  if (interval === "year") {
    next.setUTCMonth(0, 1);
  }
  return next;
}

function shiftPeriod(date: Date, interval: CompletedInterval, amount: number): Date {
  const next = new Date(date);
  if (interval === "day") next.setUTCDate(next.getUTCDate() + amount);
  if (interval === "week") next.setUTCDate(next.getUTCDate() + amount * 7);
  if (interval === "month") next.setUTCMonth(next.getUTCMonth() + amount);
  if (interval === "year") next.setUTCFullYear(next.getUTCFullYear() + amount);
  return next;
}

function periodKey(date: Date, interval: CompletedInterval): string {
  return periodStart(date, interval).toISOString().slice(0, 10);
}

function periodLabel(date: Date, interval: CompletedInterval): string {
  if (interval === "year") return String(date.getUTCFullYear());
  if (interval === "month") return date.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

function activityPeriodStart(date: Date, interval: ActivityInterval): Date {
  const next = new Date(date);
  next.setUTCSeconds(0, 0);
  if (interval === "ten-minutes") next.setUTCMinutes(Math.floor(next.getUTCMinutes() / 10) * 10);
  if (interval === "hour") next.setUTCMinutes(0);
  if (interval === "day") next.setUTCHours(0, 0, 0, 0);
  return next;
}

function shiftActivityPeriod(date: Date, interval: ActivityInterval, amount: number): Date {
  const next = new Date(date);
  if (interval === "ten-minutes") next.setUTCMinutes(next.getUTCMinutes() + amount * 10);
  if (interval === "hour") next.setUTCHours(next.getUTCHours() + amount);
  if (interval === "day") next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function activityPeriodKey(date: Date, interval: ActivityInterval): string {
  return activityPeriodStart(date, interval).toISOString();
}

function activityPeriodLabel(date: Date, interval: ActivityInterval): string {
  if (interval === "day") return date.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

function parseUtcDate(value: string): Date | undefined {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value) && Boolean(parseUtcDate(value));
}

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
