import { create } from "zustand";
import { toUserMessage } from "@/lib/userError";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { getRobotAuthForCoordinator, type RobotSlot, useGarageStore } from "@/domains/garage/garageStore";
import {
  ingestCoordinatorOrder,
  publishCoordinatorOrderActionActivity
} from "@/domains/orders/orderActivity";
import { fetchOrder, isCompleteOrderActionResponse, submitOrderAction } from "@/domains/orders/orderApi";
import type { OrderDto, SubmitOrderActionPayload } from "@/domains/orders/order.types";
import type { ApiRequestOptions } from "@/domains/transport/apiClient";
import { hasRoboSatsApiErrorCode, RoboSatsApiError } from "@/domains/transport/apiError";

let requestSequence = 0;

type OrderState = {
  order?: OrderDto;
  orderIdentity?: OrderLoadIdentity;
  loading: boolean;
  refreshing: boolean;
  submitting: boolean;
  loadFailure?: OrderLoadFailure;
  actionError?: string;
  primeOrder: (order: OrderDto, identity: OrderLoadIdentity) => void;
  loadOrder: (params: LoadOrderParams) => Promise<OrderLoadResult>;
  submitAction: (params: SubmitActionParams) => Promise<void>;
  clearOrder: () => void;
};

type LoadOrderParams = {
  coordinator: CoordinatorSummary;
  independentRead?: boolean;
  orderId: number;
  reason?: OrderLoadReason;
  slot?: RobotSlot;
};

type SubmitActionParams = LoadOrderParams & {
  payload: SubmitOrderActionPayload;
};

export type OrderLoadReason =
  | "initial"
  | "lifecycle"
  | "maintenance"
  | "manual"
  | "poll"
  | "post-action";

export type OrderLoadFailureKind = "transient" | "authentication" | "not-found" | "terminal";

export type OrderLoadFailure = {
  kind: OrderLoadFailureKind;
  message: string;
};

export type OrderLoadIdentity = {
  coordinatorEndpoint: string;
  slotId?: string;
  shortAlias: string;
  orderId: number;
};

export type OrderLoadResult =
  | { status: "loaded"; order: OrderDto }
  | { status: "unchanged"; order?: OrderDto }
  | { status: "failed"; failure: OrderLoadFailure };

export const useOrderStore = create<OrderState>((set, get) => ({
  order: undefined,
  orderIdentity: undefined,
  loading: false,
  refreshing: false,
  submitting: false,
  loadFailure: undefined,
  actionError: undefined,
  primeOrder: (order, identity) => {
    requestSequence += 1;
    set({
      order,
      orderIdentity: identity,
      loading: false,
      refreshing: false,
      submitting: false,
      loadFailure: undefined,
      actionError: undefined
    });
  },
  loadOrder: async ({ coordinator, independentRead = false, orderId, reason = "initial", slot }) => {
    if (get().submitting) return { status: "unchanged", order: get().order };
    const auth = getRobotAuthForCoordinator(slot, coordinator.shortAlias);
    if (!auth) {
      requestSequence += 1;
      const failure: OrderLoadFailure = {
        kind: "authentication",
        message: "Load a robot to fetch this private order."
      };
      set({
        order: undefined,
        orderIdentity: undefined,
        loading: false,
        refreshing: false,
        loadFailure: failure
      });
      return { status: "failed", failure };
    }

    const requestId = ++requestSequence;
    set((state) => ({ loading: !state.order, refreshing: Boolean(state.order), loadFailure: undefined }));
    try {
      const order = {
        ...(await fetchOrder(coordinator.url, orderId, auth, orderLoadRequestOptions(reason, independentRead))),
        shortAlias: coordinator.shortAlias
      };
      if (requestId !== requestSequence) return { status: "unchanged", order: get().order };
      syncGarageOrder(slot, coordinator.shortAlias, order);
      set({
        order,
        orderIdentity: loadIdentity(coordinator, slot, orderId),
        loading: false,
        refreshing: false,
        loadFailure: undefined
      });
      return { status: "loaded", order };
    } catch (error) {
      if (requestId !== requestSequence) return { status: "unchanged", order: get().order };
      const currentOrder = get().order;
      if (isAlreadyCancelledError(error) && currentOrder) {
        const order = { ...currentOrder, status: 4, status_message: "Order cancelled" };
        syncGarageOrder(slot, coordinator.shortAlias, order);
        set({
          order,
          orderIdentity: loadIdentity(coordinator, slot, orderId),
          loading: false,
          refreshing: false,
          loadFailure: undefined
        });
        return { status: "loaded", order };
      }
      const failure = classifyOrderLoadFailure(error);
      if (currentOrder && failure.kind === "transient") {
        set({ loading: false, refreshing: false, loadFailure: undefined });
        return { status: "failed", failure };
      }
      set({
        loading: false,
        refreshing: false,
        loadFailure: failure
      });
      return { status: "failed", failure };
    }
  },
  submitAction: async ({ coordinator, orderId, slot, payload }) => {
    const auth = getRobotAuthForCoordinator(slot, coordinator.shortAlias);
    if (!auth) {
      set({ actionError: "Load a robot before submitting order actions." });
      return;
    }

    const requestId = ++requestSequence;
    const previousOrder = get().order;
    const actionLocator = slot
      ? { slotId: slot.tokenSHA256, shortAlias: coordinator.shortAlias, orderId }
      : undefined;
    let snapshotApplied = false;
    set({ submitting: true, refreshing: false, actionError: undefined });
    if (actionLocator) {
      publishCoordinatorOrderActionActivity({ ...actionLocator, phase: "start" });
    }
    try {
      const responseOrder = await submitOrderAction(coordinator.url, orderId, payload, auth);
      const order = {
        ...responseOrder,
        id: orderId,
        shortAlias: coordinator.shortAlias
      };
      if (requestId !== requestSequence) return;
      if (!isCompleteOrderActionResponse(responseOrder)) {
        set({ submitting: false });
        const verification = await get().loadOrder({ coordinator, orderId, reason: "post-action", slot });
        snapshotApplied = verification.status === "loaded";
        return;
      }
      syncGarageOrder(slot, coordinator.shortAlias, order);
      snapshotApplied = true;
      if (isReleasedEarlyTake(previousOrder, order, payload) && slot) {
        useGarageStore.getState().releaseOrderReservation(slot.token, coordinator.shortAlias, orderId);
      }
      if (requestId !== requestSequence) return;
      set({
        order,
        orderIdentity: loadIdentity(coordinator, slot, orderId),
        submitting: false,
        loadFailure: undefined,
        actionError: undefined
      });
    } catch (error) {
      if (requestId !== requestSequence) return;
      if (isAlreadyCancelledError(error)) {
        const current = get().order;
        const order = current ? { ...current, status: 4, status_message: "Order cancelled" } : current;
        if (order) {
          syncGarageOrder(slot, coordinator.shortAlias, order);
          snapshotApplied = true;
        }
        set({
          order,
          orderIdentity: order ? loadIdentity(coordinator, slot, orderId) : undefined,
          submitting: false,
          loadFailure: undefined,
          actionError: undefined
        });
        return;
      }
      const verifiedOrder = await verifyRejectedPayoutAction({
        auth,
        coordinator,
        error,
        orderId,
        payload,
        previousOrder
      });
      if (requestId !== requestSequence) return;
      if (verifiedOrder) {
        syncGarageOrder(slot, coordinator.shortAlias, verifiedOrder);
        snapshotApplied = true;
        set({
          order: verifiedOrder,
          orderIdentity: loadIdentity(coordinator, slot, orderId),
          submitting: false,
          loadFailure: undefined,
          actionError: undefined
        });
        return;
      }
      set({
        submitting: false,
        actionError: toUserMessage(error, "Could not update the order.")
      });
    } finally {
      const completedOrder = snapshotApplied ? get().order : undefined;
      if (actionLocator) {
        publishCoordinatorOrderActionActivity({
          ...actionLocator,
          phase: "complete",
          snapshotApplied: Boolean(completedOrder)
        });
      }
    }
  },
  clearOrder: () => {
    requestSequence += 1;
    set({
      order: undefined,
      orderIdentity: undefined,
      loadFailure: undefined,
      actionError: undefined,
      loading: false,
      refreshing: false,
      submitting: false
    });
  }
}));

export function orderLoadIdentityMatches(
  actual: OrderLoadIdentity | undefined,
  expected: OrderLoadIdentity
): boolean {
  return Boolean(
    actual &&
    actual.coordinatorEndpoint === expected.coordinatorEndpoint &&
    actual.slotId === expected.slotId &&
    actual.shortAlias === expected.shortAlias &&
    actual.orderId === expected.orderId
  );
}

export function orderForLocator(
  order: OrderDto | undefined,
  shortAlias: string,
  orderId: number
): OrderDto | undefined {
  return order?.id === orderId && order.shortAlias === shortAlias ? order : undefined;
}

function loadIdentity(
  coordinator: Pick<CoordinatorSummary, "shortAlias" | "url">,
  slot: Pick<RobotSlot, "tokenSHA256"> | undefined,
  orderId: number
): OrderLoadIdentity {
  return {
    coordinatorEndpoint: coordinator.url,
    slotId: slot?.tokenSHA256,
    shortAlias: coordinator.shortAlias,
    orderId
  };
}

export function orderLoadRequestOptions(reason: OrderLoadReason, independentRead = false): ApiRequestOptions {
  const supersedeInFlight = independentRead || reason === "post-action";
  let options: ApiRequestOptions;
  if (reason === "poll") {
    options = { timeoutProfile: "background", priority: "background", source: "order-refresh" };
  } else if (reason === "maintenance") {
    options = { timeoutProfile: "background", priority: "maintenance", source: "order-refresh" };
  } else {
    options = { timeoutProfile: "interactive", priority: "foreground", source: "order-refresh" };
  }
  return supersedeInFlight ? { ...options, supersedeInFlight: true } : options;
}

export function isAlreadyCancelledError(error: unknown): boolean {
  if (hasRoboSatsApiErrorCode(error, 1043)) return true;
  if (!(error instanceof Error)) return false;
  return /(?:error_code["']?\s*:\s*1043|this order has been cancelled)/i.test(error.message);
}

export function isTransientOrderLoadError(error: unknown): boolean {
  return classifyOrderLoadFailure(error).kind === "transient";
}

export function classifyOrderLoadFailure(error: unknown): OrderLoadFailure {
  if (error instanceof RoboSatsApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        kind: "authentication",
        message: toUserMessage(error, "This robot could not be authenticated.")
      };
    }
    if (error.status === 404) {
      return {
        kind: "not-found",
        message: toUserMessage(error, "This order is no longer available.")
      };
    }
    if (error.status >= 500 && error.status < 600) {
      return transientOrderLoadFailure();
    }
    return {
      kind: "terminal",
      message: toUserMessage(error, "Could not fetch the order.")
    };
  }
  if (isGenericTransientOrderLoadError(error)) return transientOrderLoadFailure();
  return {
    kind: "terminal",
    message: toUserMessage(error, "Could not fetch the order.")
  };
}

function syncGarageOrder(slot: RobotSlot | undefined, shortAlias: string, order: OrderDto): void {
  ingestCoordinatorOrder({
    order,
    shortAlias,
    slot
  });
}

function isGenericTransientOrderLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (/^(?:Abort|Network|Timeout)Error$/i.test(error.name)) return true;
  return /(?:\btor\b|\bsocks\b|timeout|timed out|took too long|abort(?:ed|error)?|request (?:was )?(?:cancelled|canceled)|failed to fetch|networkerror|network request failed|connection (?:was )?(?:refused|reset|closed|aborted|failed)|transport (?:is )?(?:unavailable|not ready)|could not reach the coordinator|temporarily unavailable|unknownhost|connectexception|socketexception|sslhandshake|unable to resolve|background request deferred)/i.test(
    error.message
  );
}

function transientOrderLoadFailure(): OrderLoadFailure {
  return {
    kind: "transient",
    message: "The trade is taking longer to open."
  };
}

function isReleasedEarlyTake(
  previousOrder: OrderDto | undefined,
  order: OrderDto,
  payload: SubmitOrderActionPayload
): boolean {
  return payload.action === "cancel"
    && previousOrder?.status === 3
    && !previousOrder.is_maker
    && order.status === 1
    && !order.is_maker;
}

function payoutActionCouldHaveAdvanced(
  previousOrder: OrderDto | undefined,
  payload: SubmitOrderActionPayload
): previousOrder is OrderDto {
  return (
    Boolean(previousOrder?.is_buyer) &&
    (payload.action === "update_invoice" || payload.action === "update_address") &&
    payoutInputStatuses.has(previousOrder?.status ?? -1)
  );
}

function payoutActionAdvanced(previousOrder: OrderDto | undefined, currentOrder: OrderDto): boolean {
  return Boolean(
    previousOrder &&
      payoutInputStatuses.has(previousOrder.status) &&
      (!payoutInputStatuses.has(currentOrder.status) ||
        (previousOrder.status === 15 &&
          previousOrder.invoice_expired === true &&
          currentOrder.status === 15 &&
          currentOrder.invoice_expired !== true))
  );
}

const payoutInputStatuses = new Set([6, 8, 15]);

async function verifyRejectedPayoutAction({
  auth,
  coordinator,
  error,
  orderId,
  payload,
  previousOrder
}: {
  auth: NonNullable<ReturnType<typeof getRobotAuthForCoordinator>>;
  coordinator: CoordinatorSummary;
  error: unknown;
  orderId: number;
  payload: SubmitOrderActionPayload;
  previousOrder: OrderDto | undefined;
}): Promise<OrderDto | undefined> {
  if (!hasRoboSatsApiErrorCode(error, 1048) || !payoutActionCouldHaveAdvanced(previousOrder, payload)) {
    return undefined;
  }
  try {
    const order = await fetchOrder(
      coordinator.url,
      orderId,
      auth,
      orderLoadRequestOptions("post-action")
    );
    return payoutActionAdvanced(previousOrder, order) ? { ...order, shortAlias: coordinator.shortAlias } : undefined;
  } catch {
    // Keep the original signed-payout error when its outcome cannot be verified.
    return undefined;
  }
}
