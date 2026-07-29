import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotSlot } from "@/domains/garage/garageStore";
import {
  resetCoordinatorOrderActivityForTests,
  subscribeCoordinatorOrderActivity
} from "@/domains/orders/orderActivity";
import type { OrderDto } from "@/domains/orders/order.types";

const submitOrderActionMock = vi.hoisted(() => vi.fn());
const fetchOrderMock = vi.hoisted(() => vi.fn());
const isCompleteOrderActionResponseMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/domains/orders/orderApi", () => ({
  fetchOrder: fetchOrderMock,
  isCompleteOrderActionResponse: isCompleteOrderActionResponseMock,
  submitOrderAction: submitOrderActionMock
}));

import { useGarageStore } from "@/domains/garage/garageStore";
import { orderForLocator, orderLoadRequestOptions, useOrderStore } from "@/domains/orders/orderStore";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  submitOrderActionMock.mockReset();
  fetchOrderMock.mockReset();
  isCompleteOrderActionResponseMock.mockReset();
  isCompleteOrderActionResponseMock.mockReturnValue(true);
  resetCoordinatorOrderActivityForTests();
  useGarageStore.setState({ slots: [slot], currentToken: slot.token, hydrated: true });
  useOrderStore.getState().clearOrder();
});

describe("order API propagation", () => {
  it("publishes the same authoritative snapshot returned by a foreground GET", async () => {
    const listener = vi.fn();
    subscribeCoordinatorOrderActivity(listener);
    fetchOrderMock.mockResolvedValue({ id: 123, status: 0, is_maker: true, is_taker: false });

    await useOrderStore.getState().loadOrder({ coordinator, orderId: 123, slot });

    expect(fetchOrderMock).toHaveBeenCalledWith(
      coordinator.url,
      123,
      expect.any(Object),
      { timeoutProfile: "interactive", priority: "foreground", source: "order-refresh" }
    );
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      slotId: slot.tokenSHA256,
      shortAlias: coordinator.shortAlias,
      authoritative: true,
      order: expect.objectContaining({ id: 123, status: 0, shortAlias: coordinator.shortAlias })
    }));
  });

  it("verifies an incomplete action acknowledgement with one GET", async () => {
    useOrderStore.setState({ order: { id: 123, status: 1, is_maker: true } as OrderDto });
    submitOrderActionMock.mockResolvedValue({ id: 123 });
    isCompleteOrderActionResponseMock.mockReturnValue(false);
    fetchOrderMock.mockResolvedValue({ id: 123, status: 2, is_maker: true, is_taker: false });

    await useOrderStore.getState().submitAction({
      coordinator,
      orderId: 123,
      slot,
      payload: { action: "pause" }
    });

    expect(fetchOrderMock).toHaveBeenCalledOnce();
    expect(fetchOrderMock).toHaveBeenCalledWith(
      coordinator.url,
      123,
      expect.any(Object),
      { timeoutProfile: "interactive", priority: "foreground", source: "order-refresh" }
    );
    expect(useOrderStore.getState().order?.status).toBe(2);
  });
});

describe("order load request profiles", () => {
  it("keeps user-facing refreshes in the foreground", () => {
    for (const reason of ["initial", "lifecycle", "manual", "post-action"] as const) {
      expect(orderLoadRequestOptions(reason)).toEqual({
        timeoutProfile: "interactive",
        priority: "foreground",
        source: "order-refresh"
      });
    }
  });

  it("bounds routine and hidden polling as background work", () => {
    expect(orderLoadRequestOptions("poll")).toEqual({
      timeoutProfile: "background",
      priority: "background",
      source: "order-refresh"
    });
    expect(orderLoadRequestOptions("maintenance")).toEqual({
      timeoutProfile: "background",
      priority: "maintenance",
      source: "order-refresh"
    });
  });
});

describe("confirmed-order handoff", () => {
  it("only exposes an order to its matching coordinator route", () => {
    const order = { id: 123, shortAlias: "lake" } as OrderDto;

    expect(orderForLocator(order, "lake", 123)).toBe(order);
    expect(orderForLocator(order, "alice", 123)).toBeUndefined();
    expect(orderForLocator(order, "lake", 456)).toBeUndefined();
  });

  it("does not let an older in-flight read overwrite a confirmed order", async () => {
    let resolveOldOrder!: (order: OrderDto) => void;
    fetchOrderMock.mockImplementation(() => new Promise<OrderDto>((resolve) => {
      resolveOldOrder = resolve;
    }));
    const oldRequest = useOrderStore.getState().loadOrder({ coordinator, orderId: 123, slot });
    const confirmedOrder = {
      id: 456,
      shortAlias: coordinator.shortAlias,
      status: 0,
      is_maker: true
    } as OrderDto;

    useOrderStore.getState().primeOrder(confirmedOrder);
    resolveOldOrder({ id: 123, status: 1, is_maker: true } as OrderDto);
    await oldRequest;

    expect(useOrderStore.getState().order).toBe(confirmedOrder);
  });
});

describe("order cancellation reconciliation", () => {
  it("detaches an early taker reservation when the order returns to the public book", async () => {
    useOrderStore.setState({ order: { id: 123, status: 3, is_maker: false, is_taker: false } as OrderDto });
    submitOrderActionMock.mockResolvedValue({ id: 123, status: 1, is_maker: false, is_taker: false });

    await useOrderStore.getState().submitAction({
      coordinator,
      orderId: 123,
      slot,
      payload: { action: "cancel" }
    });

    const current = useGarageStore.getState().slots[0];
    expect(useOrderStore.getState().order?.status).toBe(1);
    expect(current.activeOrderId).toBeUndefined();
    expect(current.lastOrderId).toBeUndefined();
    expect(current.robots.lake.releasedOrderId).toBe(123);
  });

  it("keeps a genuinely cancelled order in history", async () => {
    useOrderStore.setState({ order: { id: 123, status: 3, is_maker: false, is_taker: false } as OrderDto });
    submitOrderActionMock.mockResolvedValue({ id: 123, status: 4, is_maker: false, is_taker: false });

    await useOrderStore.getState().submitAction({
      coordinator,
      orderId: 123,
      slot,
      payload: { action: "cancel" }
    });

    const current = useGarageStore.getState().slots[0];
    expect(useOrderStore.getState().order?.status).toBe(4);
    expect(current.activeOrderId).toBeUndefined();
    expect(current.lastOrderId).toBe(123);
    expect(current.robots.lake.releasedOrderId).toBeUndefined();
  });
});

const coordinator = {
  shortAlias: "lake",
  longAlias: "TheBigLake",
  color: "#000000",
  url: "https://coordinator.example",
  avatarUrl: "/lake.webp",
  smallAvatarUrl: "/lake.small.webp",
  badgeIcons: [],
  enabled: true,
  online: true
} satisfies CoordinatorSummary;

const slot: RobotSlot = {
  token: "robot-token",
  hashId: "hash",
  tokenSHA256: "token-sha",
  nostrPubKey: "nostr-public",
  nostrSecKey: new Uint8Array(),
  entropyBits: 100,
  hasEnoughEntropy: true,
  shannonEntropy: 4,
  nickname: "Robot",
  activeOrderId: 123,
  lastOrderId: 123,
  earnedRewards: 0,
  robots: {
    lake: {
      token: "robot-token",
      tokenSHA256: "token-sha",
      nostrPubKey: "nostr-public",
      pubKey: "public-key",
      encPrivKey: "private-key",
      shortAlias: "lake",
      activeOrderId: 123,
      lastOrderId: 123
    }
  }
};
