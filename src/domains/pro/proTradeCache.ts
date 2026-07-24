import { getPublicKey } from "nostr-tools/pure";
import type { OrderDto } from "@/domains/orders/order.types";
import { decryptGaragePayload, deriveGarageDomainKey, encryptGaragePayload } from "@/domains/pro/garageCrypto";
import type { ProSlotId, ProTradeKey, ProTradeSnapshot, SlotSyncState } from "@/domains/pro/pro.types";
import { proTradeKey } from "@/domains/pro/pro.types";
import { systemClient } from "@/domains/transport/systemClient";

export const PRO_TRADE_CACHE_STORAGE_KEY = "robosats_exp_pro_trade_cache_v1";

const MAX_SNAPSHOTS = 64;
const MAX_SYNC_STATES = 16;

type CachedOrder = Pick<
  OrderDto,
  | "id"
  | "status"
  | "type"
  | "amount"
  | "has_range"
  | "min_amount"
  | "max_amount"
  | "currency"
  | "payment_method"
  | "premium"
  | "satoshis"
  | "is_maker"
  | "is_taker"
  | "is_buyer"
  | "is_seller"
  | "expires_at"
  | "shortAlias"
  | "status_message"
  | "escrow_duration"
  | "total_secs_exp"
  | "maker_locked"
  | "taker_locked"
  | "escrow_locked"
  | "pending_cancel"
  | "asked_for_cancel"
  | "statement_submitted"
  | "retries"
  | "next_retry_time"
  | "failure_reason"
  | "invoice_expired"
  | "expiry_message"
  | "public_duration"
  | "bond_size"
  | "trade_fee_percent"
  | "tx_queued"
>;

type CachedSnapshot = Omit<ProTradeSnapshot, "key" | "order" | "freshness" | "errorCode"> & {
  order?: CachedOrder;
};

type CachedSyncState = Omit<SlotSyncState, "epoch" | "inFlight">;

type ProTradeCachePayload = {
  format: "robosats-exp-pro-trade-cache";
  version: 1;
  savedAt: number;
  snapshots: CachedSnapshot[];
  sync: CachedSyncState[];
};

type StoredProTradeCache = {
  format: "robosats-exp-pro-trade-cache-encrypted";
  version: 1;
  ciphertext: string;
};

export type ProTradeRuntimeCache = {
  snapshots: Record<ProTradeKey, ProTradeSnapshot>;
  syncBySlot: Record<ProSlotId, SlotSyncState>;
};

export function proTradeCacheOwner(secret: Uint8Array): string {
  return getPublicKey(deriveGarageDomainKey(secret, "trade-cache"));
}

export function loadProTradeRuntimeCache(
  secret: Uint8Array,
  activeSlotIds: ReadonlySet<string>
): ProTradeRuntimeCache {
  const empty = { snapshots: {}, syncBySlot: {} };
  const raw = systemClient.getItem(PRO_TRADE_CACHE_STORAGE_KEY);
  if (!raw) return empty;

  try {
    const stored = JSON.parse(raw) as unknown;
    if (!isStoredCache(stored)) throw new Error("Invalid encrypted cache.");
    const payload = JSON.parse(decryptGaragePayload(secret, "trade-cache", stored.ciphertext)) as unknown;
    if (!isCachePayload(payload)) throw new Error("Invalid cache payload.");
    return inflateCache(payload, activeSlotIds);
  } catch {
    systemClient.deleteItem(PRO_TRADE_CACHE_STORAGE_KEY);
    return empty;
  }
}

export function persistProTradeRuntimeCache(
  secret: Uint8Array,
  runtime: ProTradeRuntimeCache,
  activeSlotIds: ReadonlySet<string>,
  now = Date.now()
): void {
  const snapshots = Object.values(runtime.snapshots)
    .filter((snapshot) => activeSlotIds.has(snapshot.locator.slotId) && !snapshot.released)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .slice(0, MAX_SNAPSHOTS)
    .map(toCachedSnapshot);
  const sync = Object.values(runtime.syncBySlot)
    .filter((state) => activeSlotIds.has(state.slotId))
    .slice(0, MAX_SYNC_STATES)
    .map(({ epoch: _epoch, inFlight: _inFlight, ...state }) => state);
  const payload: ProTradeCachePayload = {
    format: "robosats-exp-pro-trade-cache",
    version: 1,
    savedAt: now,
    snapshots,
    sync
  };
  const stored: StoredProTradeCache = {
    format: "robosats-exp-pro-trade-cache-encrypted",
    version: 1,
    ciphertext: encryptGaragePayload(secret, "trade-cache", JSON.stringify(payload))
  };
  systemClient.setItem(PRO_TRADE_CACHE_STORAGE_KEY, JSON.stringify(stored));
}

export function clearProTradeRuntimeCache(): void {
  systemClient.deleteItem(PRO_TRADE_CACHE_STORAGE_KEY);
}

function inflateCache(
  payload: ProTradeCachePayload,
  activeSlotIds: ReadonlySet<string>
): ProTradeRuntimeCache {
  const snapshots: Record<ProTradeKey, ProTradeSnapshot> = {};
  for (const cached of payload.snapshots) {
    if (!activeSlotIds.has(cached.locator.slotId)) continue;
    const key = proTradeKey(cached.locator);
    snapshots[key] = {
      ...cached,
      key,
      order: cached.order ? inflateOrder(cached.order) : undefined,
      freshness: cached.order ? "fresh" : "stale",
      errorCode: undefined
    };
  }

  const syncBySlot: Record<ProSlotId, SlotSyncState> = {};
  for (const cached of payload.sync) {
    if (!activeSlotIds.has(cached.slotId)) continue;
    syncBySlot[cached.slotId] = {
      ...cached,
      epoch: 0,
      inFlight: false
    };
  }
  return { snapshots, syncBySlot };
}

function toCachedSnapshot(snapshot: ProTradeSnapshot): CachedSnapshot {
  const {
    key: _key,
    freshness: _freshness,
    errorCode: _errorCode,
    order,
    ...cached
  } = snapshot;
  return {
    ...cached,
    order: order ? toCachedOrder(order) : undefined
  };
}

function toCachedOrder(order: OrderDto): CachedOrder {
  return {
    id: order.id,
    status: order.status,
    type: order.type,
    amount: order.amount,
    has_range: order.has_range,
    min_amount: order.min_amount,
    max_amount: order.max_amount,
    currency: order.currency,
    payment_method: order.payment_method,
    premium: order.premium,
    satoshis: order.satoshis,
    is_maker: order.is_maker,
    is_taker: order.is_taker,
    is_buyer: order.is_buyer,
    is_seller: order.is_seller,
    expires_at: order.expires_at,
    shortAlias: order.shortAlias,
    status_message: order.status_message,
    escrow_duration: order.escrow_duration,
    total_secs_exp: order.total_secs_exp,
    maker_locked: order.maker_locked,
    taker_locked: order.taker_locked,
    escrow_locked: order.escrow_locked,
    pending_cancel: order.pending_cancel,
    asked_for_cancel: order.asked_for_cancel,
    statement_submitted: order.statement_submitted,
    retries: order.retries,
    next_retry_time: order.next_retry_time,
    failure_reason: order.failure_reason,
    invoice_expired: order.invoice_expired,
    expiry_message: order.expiry_message,
    public_duration: order.public_duration,
    bond_size: order.bond_size,
    trade_fee_percent: order.trade_fee_percent,
    tx_queued: order.tx_queued
  };
}

function inflateOrder(order: CachedOrder): OrderDto {
  return {
    ...order,
    maker_nick: "",
    maker_hash_id: "",
    taker_nick: "",
    taker_hash_id: "",
    bond_invoice: "",
    bond_satoshis: 0,
    escrow_invoice: "",
    escrow_satoshis: 0,
    invoice_amount: 0,
    swap_allowed: false,
    suggested_mining_fee_rate: 0,
    swap_fee_rate: 0
  };
}

function isStoredCache(value: unknown): value is StoredProTradeCache {
  if (!isRecord(value)) return false;
  return value.format === "robosats-exp-pro-trade-cache-encrypted"
    && value.version === 1
    && typeof value.ciphertext === "string"
    && value.ciphertext.length > 0;
}

function isCachePayload(value: unknown): value is ProTradeCachePayload {
  if (!isRecord(value)) return false;
  if (value.format !== "robosats-exp-pro-trade-cache" || value.version !== 1) return false;
  if (!isFiniteNumber(value.savedAt) || !Array.isArray(value.snapshots) || !Array.isArray(value.sync)) return false;
  if (value.snapshots.length > MAX_SNAPSHOTS || value.sync.length > MAX_SYNC_STATES) return false;
  return value.snapshots.every(isCachedSnapshot) && value.sync.every(isCachedSyncState);
}

function isCachedSnapshot(value: unknown): value is CachedSnapshot {
  if (!isRecord(value) || !isRecord(value.locator)) return false;
  const locator = value.locator;
  return isString(locator.slotId)
    && isString(locator.shortAlias)
    && isPositiveInteger(locator.orderId)
    && isString(value.nickname)
    && isString(value.hashId)
    && typeof value.renewable === "boolean"
    && typeof value.released === "boolean"
    && optionalPositiveInteger(value.activeOrderId)
    && optionalPositiveInteger(value.lastOrderId)
    && optionalFiniteNumber(value.updatedAt)
    && optionalFiniteNumber(value.changedAt)
    && (value.order === undefined || isCachedOrder(value.order));
}

function isCachedOrder(value: unknown): value is CachedOrder {
  if (!isRecord(value)) return false;
  return isPositiveInteger(value.id)
    && Number.isInteger(value.status)
    && Number.isInteger(value.type)
    && (value.amount === null || isFiniteNumber(value.amount))
    && Number.isInteger(value.currency)
    && isString(value.payment_method)
    && isFiniteNumber(value.premium)
    && isFiniteNumber(value.satoshis)
    && typeof value.is_maker === "boolean"
    && typeof value.is_taker === "boolean"
    && typeof value.is_buyer === "boolean"
    && typeof value.is_seller === "boolean"
    && isString(value.expires_at)
    && isString(value.shortAlias)
    && optionalBoolean(value.has_range)
    && optionalFiniteNumber(value.min_amount)
    && optionalFiniteNumber(value.max_amount)
    && optionalString(value.status_message)
    && optionalFiniteNumber(value.escrow_duration)
    && optionalFiniteNumber(value.total_secs_exp)
    && optionalBoolean(value.maker_locked)
    && optionalBoolean(value.taker_locked)
    && optionalBoolean(value.escrow_locked)
    && optionalBoolean(value.pending_cancel)
    && optionalBoolean(value.asked_for_cancel)
    && optionalBoolean(value.statement_submitted)
    && optionalFiniteNumber(value.retries)
    && optionalString(value.next_retry_time)
    && optionalString(value.failure_reason)
    && optionalBoolean(value.invoice_expired)
    && optionalString(value.expiry_message)
    && optionalFiniteNumber(value.public_duration)
    && optionalFiniteNumber(value.bond_size)
    && optionalFiniteNumber(value.trade_fee_percent)
    && optionalBoolean(value.tx_queued);
}

function isCachedSyncState(value: unknown): value is CachedSyncState {
  if (!isRecord(value) || !isString(value.slotId)) return false;
  return optionalFiniteNumber(value.attemptedCoordinators)
    && optionalFiniteNumber(value.locallyReadyAt)
    && optionalFiniteNumber(value.lastAttemptAt)
    && optionalFiniteNumber(value.lastSuccessAt)
    && optionalFiniteNumber(value.nextEligibleAt)
    && optionalString(value.error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function optionalPositiveInteger(value: unknown): boolean {
  return value === undefined || isPositiveInteger(value);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function optionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}
