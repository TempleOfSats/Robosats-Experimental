import { sha256 } from "js-sha256";
import { apiRoutes, type ApiClient, type Auth } from "@/domains/transport/apiClient";
import { apiClient } from "@/domains/transport/apiWebClient";
import {
  durationIsInRange,
  ESCROW_DURATION_MAX_SECONDS,
  ESCROW_DURATION_MIN_SECONDS,
  PUBLIC_DURATION_MAX_SECONDS,
  PUBLIC_DURATION_MIN_SECONDS
} from "@/domains/maker/makerDurations";
import type { CreateOrderDraft, CreateOrderPayload, CreateOrderResponse } from "@/domains/maker/maker.types";
import type { OrderDto } from "@/domains/orders/order.types";

export async function createOrder(
  baseUrl: string,
  payload: CreateOrderPayload,
  auth: Auth,
  client: ApiClient = apiClient
): Promise<CreateOrderResponse> {
  return client.post<CreateOrderResponse>(baseUrl, apiRoutes.make, payload, auth, { timeoutProfile: "action" });
}

export function buildCreateOrderPayload(draft: CreateOrderDraft): CreateOrderPayload {
  const amount = parseNumericField(draft.amount);
  const password = draft.password.trim();
  const description = draft.description.trim();

  return {
    type: draft.type,
    currency: draft.currency,
    amount: draft.hasRange ? null : amount,
    has_range: draft.hasRange,
    min_amount: draft.hasRange ? parseNumericField(draft.minAmount) : null,
    max_amount: draft.hasRange ? parseNumericField(draft.maxAmount) : null,
    payment_method: draft.paymentMethod.trim(),
    is_explicit: draft.isExplicit,
    premium: draft.isExplicit ? null : parseNumericField(draft.premium),
    satoshis: draft.isExplicit ? parseIntegerField(draft.satoshis) : null,
    public_duration: parseIntegerField(draft.publicDuration),
    escrow_duration: parseIntegerField(draft.escrowDuration),
    bond_size: parseNumericField(draft.bondSize),
    latitude: parseNumericField(draft.latitude),
    longitude: parseNumericField(draft.longitude),
    password: password ? sha256(password) : null,
    description: description || null
  };
}

export function buildRenewOrderPayload(order: OrderDto, password = ""): CreateOrderPayload {
  const hasRange = Boolean(order.has_range);
  const isExplicit = Boolean(order.is_explicit);
  const normalizedPassword = password.trim();

  return {
    type: order.type === 1 ? 1 : 0,
    currency: order.currency,
    amount: hasRange ? null : order.amount,
    has_range: hasRange,
    min_amount: hasRange ? order.min_amount ?? null : null,
    max_amount: hasRange ? order.max_amount ?? null : null,
    payment_method: order.payment_method,
    is_explicit: isExplicit,
    premium: isExplicit ? null : order.premium,
    satoshis: isExplicit ? order.satoshis : null,
    public_duration: order.public_duration || 86_340,
    escrow_duration: order.escrow_duration || 10_800,
    bond_size: order.bond_size || 3,
    latitude: order.latitude ?? 0,
    longitude: order.longitude ?? 0,
    password: normalizedPassword ? sha256(normalizedPassword) : null,
    description: order.description?.trim() || null
  };
}

export function validateCreateOrderPayload(payload: CreateOrderPayload): string[] {
  const errors: string[] = [];
  if (!payload.payment_method) errors.push("Add a payment method.");
  if (payload.has_range) {
    if (payload.min_amount === null || payload.max_amount === null || payload.min_amount <= 0 || payload.max_amount <= 0) {
      errors.push("Add a valid amount range.");
    } else if (payload.min_amount > payload.max_amount) {
      errors.push("Minimum amount must be below maximum amount.");
    }
  } else if (payload.amount === null || payload.amount <= 0) {
    errors.push("Add a valid amount.");
  }
  if (payload.is_explicit && (payload.satoshis === null || payload.satoshis <= 0)) errors.push("Add the explicit satoshi amount.");
  if (!payload.is_explicit && payload.premium === null) errors.push("Add a valid premium.");
  if (!durationIsInRange(payload.public_duration, PUBLIC_DURATION_MIN_SECONDS, PUBLIC_DURATION_MAX_SECONDS)) {
    errors.push("Public duration must be between 00:10 and 23:59.");
  }
  if (!durationIsInRange(payload.escrow_duration, ESCROW_DURATION_MIN_SECONDS, ESCROW_DURATION_MAX_SECONDS)) {
    errors.push("Escrow duration must be between 01:00 and 08:00.");
  }
  if (payload.bond_size <= 0) errors.push("Bond size must be positive.");
  return errors;
}

function parseNumericField(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIntegerField(value: string): number {
  return Math.trunc(parseNumericField(value));
}
