import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigateFunction } from "react-router-dom";
import type { OrderDto } from "@/domains/orders/order.types";

const beginRouteTransitionMock = vi.hoisted(() => vi.fn());

vi.mock("@/domains/navigation/routeTransition", () => ({
  beginRouteTransition: beginRouteTransitionMock
}));

import { openConfirmedOrder } from "@/domains/orders/confirmedOrderNavigation";
import { useOrderStore } from "@/domains/orders/orderStore";

beforeEach(() => {
  beginRouteTransitionMock.mockReset();
  useOrderStore.getState().clearOrder();
});

describe("confirmed-order navigation", () => {
  it("primes the matching trade before navigating to it", () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    const order = { id: 321, shortAlias: "lake", status: 0 } as OrderDto;

    const path = openConfirmedOrder(navigate, {
      coordinatorEndpoint: "https://lake.example",
      initialOrder: order,
      orderId: 321,
      shortAlias: "lake",
      slotId: "slot-sha"
    });

    expect(path).toBe("/order/lake/321");
    expect(useOrderStore.getState().order).toEqual(order);
    expect(useOrderStore.getState().orderIdentity).toEqual({
      coordinatorEndpoint: "https://lake.example",
      slotId: "slot-sha",
      shortAlias: "lake",
      orderId: 321
    });
    expect(beginRouteTransitionMock).toHaveBeenCalledWith(path);
    expect(navigate).toHaveBeenCalledWith(path, { state: { robotSlotId: "slot-sha" } });
  });

  it("clears an unrelated stale trade when no complete handoff is available", () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    useOrderStore.getState().primeOrder({ id: 99, shortAlias: "alice" } as OrderDto, {
      coordinatorEndpoint: "https://alice.example",
      slotId: "old-slot",
      shortAlias: "alice",
      orderId: 99
    });

    openConfirmedOrder(navigate, {
      coordinatorEndpoint: "https://lake.example",
      orderId: 321,
      shortAlias: "lake",
      slotId: "slot-sha"
    });

    expect(useOrderStore.getState().order).toBeUndefined();
    expect(useOrderStore.getState().orderIdentity).toBeUndefined();
    expect(navigate).toHaveBeenCalledOnce();
  });
});
