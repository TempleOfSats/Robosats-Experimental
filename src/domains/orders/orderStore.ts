import { create } from "zustand";
import { toUserMessage } from "@/lib/userError";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { getRobotAuthForCoordinator, type RobotSlot, useGarageStore } from "@/domains/garage/garageStore";
import { fetchOrder, submitOrderAction } from "@/domains/orders/orderApi";
import type { OrderDto, SubmitOrderActionPayload } from "@/domains/orders/order.types";

let requestSequence = 0;

type OrderState = {
  order?: OrderDto;
  loading: boolean;
  refreshing: boolean;
  submitting: boolean;
  error?: string;
  loadOrder: (params: LoadOrderParams) => Promise<void>;
  submitAction: (params: SubmitActionParams) => Promise<void>;
  clearOrder: () => void;
};

type LoadOrderParams = {
  coordinator: CoordinatorSummary;
  orderId: number;
  slot?: RobotSlot;
};

type SubmitActionParams = LoadOrderParams & {
  payload: SubmitOrderActionPayload;
};

export const useOrderStore = create<OrderState>((set, get) => ({
  order: undefined,
  loading: false,
  refreshing: false,
  submitting: false,
  loadOrder: async ({ coordinator, orderId, slot }) => {
    if (get().submitting) return;
    const auth = getRobotAuthForCoordinator(slot, coordinator.shortAlias);
    if (!auth) {
      set({ order: undefined, loading: false, refreshing: false, error: "Load a robot to fetch this private order." });
      return;
    }

    const requestId = ++requestSequence;
    set((state) => ({ loading: !state.order, refreshing: Boolean(state.order), error: undefined }));
    try {
      const order = { ...(await fetchOrder(coordinator.url, orderId, auth)), shortAlias: coordinator.shortAlias };
      if (requestId !== requestSequence) return;
      syncGarageOrder(slot, coordinator.shortAlias, order);
      set({ order, loading: false, refreshing: false });
    } catch (error) {
      if (requestId !== requestSequence) return;
      const currentOrder = get().order;
      if (isAlreadyCancelledError(error) && currentOrder) {
        const order = { ...currentOrder, status: 4, status_message: "Order cancelled" };
        syncGarageOrder(slot, coordinator.shortAlias, order);
        set({ order, loading: false, refreshing: false, error: undefined });
        return;
      }
      if (currentOrder && isTransientOrderLoadError(error)) {
        set({ loading: false, refreshing: false, error: undefined });
        return;
      }
      set({
        loading: false,
        refreshing: false,
        error: toUserMessage(error, "Could not fetch the order.")
      });
    }
  },
  submitAction: async ({ coordinator, orderId, slot, payload }) => {
    const auth = getRobotAuthForCoordinator(slot, coordinator.shortAlias);
    if (!auth) {
      set({ error: "Load a robot before submitting order actions." });
      return;
    }

    const requestId = ++requestSequence;
    const previousOrder = get().order;
    set({ submitting: true, refreshing: false, error: undefined });
    try {
      const order = {
        ...(await submitOrderAction(coordinator.url, orderId, payload, auth)),
        id: orderId,
        shortAlias: coordinator.shortAlias
      };
      if (requestId !== requestSequence) return;
      syncGarageOrder(slot, coordinator.shortAlias, order);
      if (isReleasedEarlyTake(previousOrder, order, payload) && slot) {
        useGarageStore.getState().releaseOrderReservation(slot.token, coordinator.shortAlias, orderId);
      }
      if (requestId !== requestSequence) return;
      set({ order, submitting: false });
    } catch (error) {
      if (requestId !== requestSequence) return;
      if (isAlreadyCancelledError(error)) {
        const current = get().order;
        const order = current ? { ...current, status: 4, status_message: "Order cancelled" } : current;
        if (order) syncGarageOrder(slot, coordinator.shortAlias, order);
        set({ order, submitting: false, error: undefined });
        return;
      }
      set({
        submitting: false,
        error: toUserMessage(error, "Could not update the order.")
      });
    }
  },
  clearOrder: () => {
    requestSequence += 1;
    set({ order: undefined, error: undefined, loading: false, refreshing: false, submitting: false });
  }
}));

export function isAlreadyCancelledError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:error_code["']?\s*:\s*1043|this order has been cancelled)/i.test(error.message);
}

export function isTransientOrderLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:timeout|timed out|took too long|failed to fetch|networkerror|network request failed|connection refused|transport is unavailable|could not reach the coordinator|temporarily unavailable|unknownhost|connectexception|socketexception|sslhandshake|unable to resolve)/i.test(
    error.message
  );
}

function syncGarageOrder(slot: RobotSlot | undefined, shortAlias: string, order: OrderDto): void {
  if (!slot || !order.id) return;
  useGarageStore.getState().syncOrderSnapshot({
    token: slot.token,
    shortAlias,
    orderId: order.id,
    status: order.status,
    isMaker: order.is_maker
  });
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
