import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { OrderDto } from "@/domains/orders/order.types";
import { isCompletedTradeForCurrentRobot } from "@/domains/orders/orderStateMachine";

const encoder = new TextEncoder();

export const TRADE_HISTORY_LIMITS = {
  entries: 100,
  retentionMs: 365 * 24 * 60 * 60 * 1_000,
  manifestBytes: 768 * 1_024,
  robotNameLength: 64,
  coordinatorLength: 64,
  paymentMethodLength: 160,
  invoiceLength: 4_096
} as const;

export type TradeHistoryOutcome =
  | "completed"
  | "collaboratively-cancelled";

export type TradeHistoryEntry = {
  id: string;
  slotId: string;
  robotName: string;
  robotHashId: string;
  coordinatorShortAlias: string;
  orderId: number;
  role: "buyer" | "seller";
  origin: "maker" | "taker";
  amount?: number;
  currency: number;
  paymentMethod: string;
  premium: number;
  satoshis: number;
  settlementInvoice?: string;
  settlementInvoicePurpose?: "payout-received" | "escrow-paid";
  outcome: TradeHistoryOutcome;
  completedAt: number;
  revision: number;
  deviceId: string;
  updatedAt: number;
};

export type TradeHistoryManifest = {
  format: "robosats-exp-trade-history";
  version: 1;
  deviceId: string;
  revision: number;
  updatedAt: number;
  entries: TradeHistoryEntry[];
};

export type ArchiveTradeInput = {
  slotId: string;
  robotName: string;
  robotHashId: string;
  coordinatorShortAlias: string;
  order: OrderDto;
  settlementInvoice?: string;
  settlementInvoicePurpose?: "payout-received" | "escrow-paid";
  observedAt?: number;
};

export function createTradeHistoryManifest(deviceId: string, now = Date.now()): TradeHistoryManifest {
  return {
    format: "robosats-exp-trade-history",
    version: 1,
    deviceId,
    revision: 0,
    updatedAt: now,
    entries: []
  };
}

export function tradeHistoryEntryFromOrder(
  input: ArchiveTradeInput,
  deviceId: string
): TradeHistoryEntry | undefined {
  const outcome = outcomeFromOrder(input.order);
  if (!outcome || (!input.order.is_buyer && !input.order.is_seller)) return undefined;
  const completedAt = input.observedAt ?? Date.now();
  const id = historyEntryId(input.slotId, input.coordinatorShortAlias, input.order.id);
  const settlement = validatedSettlement(input);
  return {
    id,
    slotId: input.slotId,
    robotName: cleanText(input.robotName, TRADE_HISTORY_LIMITS.robotNameLength),
    robotHashId: input.robotHashId,
    coordinatorShortAlias: cleanText(input.coordinatorShortAlias, TRADE_HISTORY_LIMITS.coordinatorLength),
    orderId: input.order.id,
    role: input.order.is_buyer ? "buyer" : "seller",
    origin: input.order.is_maker ? "maker" : "taker",
    amount: finiteNumber(input.order.amount),
    currency: input.order.currency,
    paymentMethod: cleanText(input.order.payment_method, TRADE_HISTORY_LIMITS.paymentMethodLength),
    premium: finiteNumber(input.order.premium) ?? 0,
    satoshis: finiteNumber(input.order.trade_satoshis ?? input.order.satoshis) ?? 0,
    ...settlement,
    outcome,
    completedAt,
    revision: 1,
    deviceId,
    updatedAt: completedAt
  };
}

export function upsertTradeHistoryEntry(
  manifest: TradeHistoryManifest,
  entry: TradeHistoryEntry,
  now = Date.now()
): TradeHistoryManifest {
  const existing = manifest.entries.find((candidate) => candidate.id === entry.id);
  const nextEntry = existing ? mergeTradeHistoryEntries(existing, entry) : entry;
  const entries = pruneTradeHistoryEntries(
    [...manifest.entries.filter((candidate) => candidate.id !== entry.id), nextEntry],
    now
  );
  const changed = JSON.stringify(entries) !== JSON.stringify(manifest.entries);
  if (!changed) return manifest;
  const next = {
    ...manifest,
    revision: manifest.revision + 1,
    updatedAt: Math.max(manifest.updatedAt, entry.updatedAt, now),
    entries
  };
  validateTradeHistoryManifest(next);
  return next;
}

export function archiveTradeHistoryEntry(
  manifest: TradeHistoryManifest,
  entry: TradeHistoryEntry,
  now = Date.now()
): TradeHistoryManifest {
  const existing = manifest.entries.find((candidate) => candidate.id === entry.id);
  if (!existing) return upsertTradeHistoryEntry(manifest, entry, now);

  const candidate = preserveSettlement({
    ...entry,
    completedAt: existing.completedAt,
    revision: existing.revision + 1,
    deviceId: manifest.deviceId,
    updatedAt: Math.max(now, entry.updatedAt)
  }, existing);
  if (sameTradeHistoryContent(existing, candidate)) return manifest;
  return upsertTradeHistoryEntry(manifest, candidate, now);
}

export function mergeTradeHistoryManifests(
  manifests: TradeHistoryManifest[],
  deviceId: string,
  now = Date.now()
): TradeHistoryManifest {
  const latest = new Map<string, TradeHistoryEntry>();
  for (const manifest of manifests) {
    validateTradeHistoryManifest(manifest);
    for (const entry of manifest.entries) {
      const current = latest.get(entry.id);
      latest.set(entry.id, current ? mergeTradeHistoryEntries(current, entry) : entry);
    }
  }
  const entries = pruneTradeHistoryEntries([...latest.values()], now);
  const revision = Math.max(0, ...manifests.map((manifest) => manifest.revision));
  const updatedAt = Math.max(now, ...manifests.map((manifest) => manifest.updatedAt));
  const merged: TradeHistoryManifest = {
    format: "robosats-exp-trade-history",
    version: 1,
    deviceId,
    revision,
    updatedAt,
    entries
  };
  validateTradeHistoryManifest(merged);
  return merged;
}

export function pruneTradeHistoryManifest(
  manifest: TradeHistoryManifest,
  now = Date.now()
): TradeHistoryManifest {
  const entries = pruneTradeHistoryEntries(manifest.entries, now);
  if (JSON.stringify(entries) === JSON.stringify(manifest.entries)) return manifest;
  return {
    ...manifest,
    revision: manifest.revision + 1,
    updatedAt: now,
    entries
  };
}

function compareTradeHistoryEntries(left: TradeHistoryEntry, right: TradeHistoryEntry): number {
  if (left.revision !== right.revision) return left.revision - right.revision;
  const deviceOrder = left.deviceId.localeCompare(right.deviceId);
  return deviceOrder || left.updatedAt - right.updatedAt;
}

function mergeTradeHistoryEntries(
  left: TradeHistoryEntry,
  right: TradeHistoryEntry
): TradeHistoryEntry {
  const winner = compareTradeHistoryEntries(left, right) >= 0 ? left : right;
  const other = winner === left ? right : left;
  return preserveSettlement(winner, other);
}

function preserveSettlement(
  winner: TradeHistoryEntry,
  other: TradeHistoryEntry
): TradeHistoryEntry {
  if (winner.settlementInvoice || !other.settlementInvoice) return winner;
  return {
    ...winner,
    settlementInvoice: other.settlementInvoice,
    settlementInvoicePurpose: other.settlementInvoicePurpose
  };
}

function sameTradeHistoryContent(left: TradeHistoryEntry, right: TradeHistoryEntry): boolean {
  const metadata = new Set<keyof TradeHistoryEntry>(["revision", "deviceId", "updatedAt"]);
  return (Object.keys(left) as Array<keyof TradeHistoryEntry>)
    .filter((key) => !metadata.has(key))
    .every((key) => left[key] === right[key])
    && (Object.keys(right) as Array<keyof TradeHistoryEntry>)
      .filter((key) => !metadata.has(key))
      .every((key) => left[key] === right[key]);
}

export function validateTradeHistoryEntry(value: unknown): asserts value is TradeHistoryEntry {
  if (!value || typeof value !== "object") throw new Error("Invalid trade history entry.");
  const entry = value as Partial<TradeHistoryEntry>;
  const fields = new Set([
    "id", "slotId", "robotName", "robotHashId", "coordinatorShortAlias", "orderId", "role", "origin",
    "amount", "currency", "paymentMethod", "premium", "satoshis", "outcome", "completedAt", "revision",
    "deviceId", "updatedAt", "settlementInvoice", "settlementInvoicePurpose"
  ]);
  if (Object.keys(entry).some((key) => !fields.has(key))) throw new Error("Trade history entry has unknown fields.");
  if (!/^[0-9a-f]{32}$/.test(entry.id ?? "")
    || !/^[0-9a-f]{64}$/.test(entry.slotId ?? "")
    || !/^[0-9a-f]{32}$/.test(entry.deviceId ?? "")) {
    throw new Error("Invalid trade history identity.");
  }
  if (typeof entry.robotName !== "string" || entry.robotName.length > TRADE_HISTORY_LIMITS.robotNameLength
    || typeof entry.robotHashId !== "string" || entry.robotHashId.length > 256
    || typeof entry.coordinatorShortAlias !== "string"
    || entry.coordinatorShortAlias.length > TRADE_HISTORY_LIMITS.coordinatorLength
    || typeof entry.paymentMethod !== "string"
    || entry.paymentMethod.length > TRADE_HISTORY_LIMITS.paymentMethodLength) {
    throw new Error("Invalid trade history label.");
  }
  if (!Number.isSafeInteger(entry.orderId) || Number(entry.orderId) < 1
    || !Number.isSafeInteger(entry.currency)
    || !Number.isSafeInteger(entry.completedAt) || Number(entry.completedAt) < 0
    || !Number.isSafeInteger(entry.updatedAt) || Number(entry.updatedAt) < 0
    || !Number.isSafeInteger(entry.revision) || Number(entry.revision) < 1
    || !isFiniteOptional(entry.amount)
    || !Number.isFinite(entry.premium)
    || !Number.isFinite(entry.satoshis) || Number(entry.satoshis) < 0) {
    throw new Error("Invalid trade history value.");
  }
  if (entry.role !== "buyer" && entry.role !== "seller") throw new Error("Invalid trade history role.");
  if ((entry.settlementInvoice === undefined) !== (entry.settlementInvoicePurpose === undefined)
    || (entry.settlementInvoice !== undefined && (
      entry.settlementInvoice.length < 20
      || entry.settlementInvoice.length > TRADE_HISTORY_LIMITS.invoiceLength
      || !/^ln[a-z0-9]+$/i.test(entry.settlementInvoice)
    ))
    || (entry.settlementInvoicePurpose !== undefined
      && entry.settlementInvoicePurpose !== "payout-received"
      && entry.settlementInvoicePurpose !== "escrow-paid")
    || (entry.role === "buyer" && entry.settlementInvoicePurpose === "escrow-paid")
    || (entry.role === "seller" && entry.settlementInvoicePurpose === "payout-received")) {
    throw new Error("Invalid trade history settlement invoice.");
  }
  if (entry.origin !== "maker" && entry.origin !== "taker") throw new Error("Invalid trade history origin.");
  if (entry.outcome !== "completed" && entry.outcome !== "collaboratively-cancelled") {
    throw new Error("Invalid trade history outcome.");
  }
}

export function validateTradeHistoryManifest(value: unknown): asserts value is TradeHistoryManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid trade history.");
  const manifest = value as Partial<TradeHistoryManifest>;
  const fields = new Set(["format", "version", "deviceId", "revision", "updatedAt", "entries"]);
  if (Object.keys(manifest).some((key) => !fields.has(key))) throw new Error("Trade history has unknown fields.");
  if (manifest.format !== "robosats-exp-trade-history" || manifest.version !== 1
    || !/^[0-9a-f]{32}$/.test(manifest.deviceId ?? "")
    || !Number.isSafeInteger(manifest.revision) || Number(manifest.revision) < 0
    || !Number.isSafeInteger(manifest.updatedAt) || Number(manifest.updatedAt) < 0
    || !Array.isArray(manifest.entries)
    || manifest.entries.length > TRADE_HISTORY_LIMITS.entries
    || new Set(manifest.entries.map((entry) => entry.id)).size !== manifest.entries.length) {
    throw new Error("Invalid trade history.");
  }
  for (const entry of manifest.entries) validateTradeHistoryEntry(entry);
  if (encoder.encode(JSON.stringify(manifest)).length > TRADE_HISTORY_LIMITS.manifestBytes) {
    throw new Error("Trade history is too large.");
  }
}

function outcomeFromOrder(order: OrderDto): TradeHistoryOutcome | undefined {
  if (isCompletedTradeForCurrentRobot(order)) return "completed";
  if (order.status === 12) return "collaboratively-cancelled";
  return undefined;
}

function validatedSettlement(input: ArchiveTradeInput): Pick<
  TradeHistoryEntry,
  "settlementInvoice" | "settlementInvoicePurpose"
> {
  const purpose = input.settlementInvoicePurpose;
  const invoice = cleanInvoice(input.settlementInvoice);
  const outcome = outcomeFromOrder(input.order);
  const buyerReceivedPayout = outcome === "completed";
  const roleMatches = (input.order.is_buyer && buyerReceivedPayout && purpose === "payout-received")
    || (input.order.is_seller && purpose === "escrow-paid");
  return invoice && roleMatches ? { settlementInvoice: invoice, settlementInvoicePurpose: purpose } : {};
}

function historyEntryId(slotId: string, coordinatorShortAlias: string, orderId: number): string {
  return bytesToHex(sha256(encoder.encode(`${slotId}:${coordinatorShortAlias}:${orderId}`))).slice(0, 32);
}

function pruneTradeHistoryEntries(entries: TradeHistoryEntry[], now: number): TradeHistoryEntry[] {
  const cutoff = now - TRADE_HISTORY_LIMITS.retentionMs;
  const sorted = entries
    .filter((entry) =>
      (entry.outcome === "completed" || entry.outcome === "collaboratively-cancelled")
      && entry.completedAt >= cutoff
      && entry.completedAt <= now + 15 * 60 * 1_000
    )
    .sort((left, right) => right.completedAt - left.completedAt || left.id.localeCompare(right.id))
    .slice(0, TRADE_HISTORY_LIMITS.entries);
  while (sorted.length > 0 && encoder.encode(JSON.stringify({
    format: "robosats-exp-trade-history",
    version: 1,
    deviceId: sorted[0].deviceId,
    revision: 1,
    updatedAt: now,
    entries: sorted
  })).length > TRADE_HISTORY_LIMITS.manifestBytes) {
    sorted.pop();
  }
  return sorted;
}

function cleanText(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function finiteNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isFiniteOptional(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function cleanInvoice(value: string | undefined): string | undefined {
  const invoice = value?.trim();
  if (!invoice
    || invoice.length < 20
    || invoice.length > TRADE_HISTORY_LIMITS.invoiceLength
    || !/^ln[a-z0-9]+$/i.test(invoice)) return undefined;
  return invoice;
}
