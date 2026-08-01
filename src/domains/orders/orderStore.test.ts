import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotSlot } from "@/domains/garage/garageStore";
import {
  resetCoordinatorOrderActivityForTests,
  subscribeCoordinatorOrderActionActivity,
  subscribeCoordinatorOrderActivity
} from "@/domains/orders/orderActivity";
import type { OrderDto } from "@/domains/orders/order.types";
import { RoboSatsApiError } from "@/domains/transport/apiError";

const submitOrderActionMock = vi.hoisted(() => vi.fn());
const fetchOrderMock = vi.hoisted(() => vi.fn());
const isCompleteOrderActionResponseMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/domains/orders/orderApi", () => ({
  fetchOrder: fetchOrderMock,
  isCompleteOrderActionResponse: isCompleteOrderActionResponseMock,
  submitOrderAction: submitOrderActionMock
}));

import { useGarageStore } from "@/domains/garage/garageStore";
import {
  classifyOrderLoadFailure,
  orderLoadIdentityMatches,
  orderForLocator,
  orderLoadRequestOptions,
  useOrderStore
} from "@/domains/orders/orderStore";

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
    expect(useOrderStore.getState().orderIdentity).toEqual({
      coordinatorEndpoint: coordinator.url,
      slotId: slot.tokenSHA256,
      shortAlias: coordinator.shortAlias,
      orderId: 123
    });
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
      {
        timeoutProfile: "interactive",
        priority: "foreground",
        source: "order-refresh",
        supersedeInFlight: true
      }
    );
    expect(useOrderStore.getState().order?.status).toBe(2);
  });

  it("requests reconciliation when incomplete action verification fails", async () => {
    const listener = vi.fn();
    subscribeCoordinatorOrderActionActivity(listener);
    useOrderStore.setState({ order: { id: 123, status: 1, is_maker: true } as OrderDto });
    submitOrderActionMock.mockResolvedValue({ id: 123 });
    isCompleteOrderActionResponseMock.mockReturnValue(false);
    fetchOrderMock.mockRejectedValue(new DOMException("Tor request failed", "NetworkError"));

    await useOrderStore.getState().submitAction({
      coordinator,
      orderId: 123,
      slot,
      payload: { action: "pause" }
    });

    expect(useOrderStore.getState().order?.status).toBe(1);
    expect(listener).toHaveBeenLastCalledWith({
      phase: "complete",
      slotId: slot.tokenSHA256,
      shortAlias: coordinator.shortAlias,
      orderId: 123,
      snapshotApplied: false
    });
  });

  it("publishes typed action start and completion with the applied snapshot", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCoordinatorOrderActionActivity(listener);
    useOrderStore.setState({ order: { id: 123, status: 1, is_maker: true } as OrderDto });
    submitOrderActionMock.mockResolvedValue({
      id: 123,
      status: 2,
      is_maker: true,
      is_seller: false
    });

    await useOrderStore.getState().submitAction({
      coordinator,
      orderId: 123,
      slot,
      payload: { action: "pause" }
    });

    expect(listener.mock.calls).toEqual([
      [{
        phase: "start",
        slotId: slot.tokenSHA256,
        shortAlias: coordinator.shortAlias,
        orderId: 123
      }],
      [{
        phase: "complete",
        slotId: slot.tokenSHA256,
        shortAlias: coordinator.shortAlias,
        orderId: 123,
        snapshotApplied: true
      }]
    ]);
    expect(useOrderStore.getState().orderIdentity).toEqual({
      coordinatorEndpoint: coordinator.url,
      slotId: slot.tokenSHA256,
      shortAlias: coordinator.shortAlias,
      orderId: 123
    });

    unsubscribe();
    await useOrderStore.getState().submitAction({
      coordinator,
      orderId: 123,
      slot,
      payload: { action: "pause" }
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("publishes action completion without a snapshot when the action fails", async () => {
    const listener = vi.fn();
    subscribeCoordinatorOrderActionActivity(listener);
    submitOrderActionMock.mockRejectedValue(new Error("The action was rejected."));

    await useOrderStore.getState().submitAction({
      coordinator,
      orderId: 123,
      slot,
      payload: { action: "pause" }
    });

    expect(listener).toHaveBeenNthCalledWith(1, {
      phase: "start",
      slotId: slot.tokenSHA256,
      shortAlias: coordinator.shortAlias,
      orderId: 123
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      phase: "complete",
      slotId: slot.tokenSHA256,
      shortAlias: coordinator.shortAlias,
      orderId: 123,
      snapshotApplied: false
    });
  });
});

describe("order load request profiles", () => {
  it("keeps user-facing refreshes in the foreground", () => {
    for (const reason of ["initial", "lifecycle", "manual"] as const) {
      expect(orderLoadRequestOptions(reason)).toEqual({
        timeoutProfile: "interactive",
        priority: "foreground",
        source: "order-refresh"
      });
    }
    expect(orderLoadRequestOptions("post-action")).toEqual({
      timeoutProfile: "interactive",
      priority: "foreground",
      source: "order-refresh",
      supersedeInFlight: true
    });
    expect(orderLoadRequestOptions("initial", true)).toEqual({
      timeoutProfile: "interactive",
      priority: "foreground",
      source: "order-refresh",
      supersedeInFlight: true
    });
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
    expect(orderLoadRequestOptions("poll", true)).toEqual({
      timeoutProfile: "background",
      priority: "background",
      source: "order-refresh",
      supersedeInFlight: true
    });
  });
});

describe("order load outcomes", () => {
  it("does not let an older read restore an order after authentication clears it", async () => {
    let resolveOldOrder!: (order: OrderDto) => void;
    fetchOrderMock.mockImplementation(
      () =>
        new Promise<OrderDto>((resolve) => {
          resolveOldOrder = resolve;
        })
    );
    const oldRequest = useOrderStore.getState().loadOrder({ coordinator, orderId: 123, slot });

    const authFailure = await useOrderStore.getState().loadOrder({
      coordinator,
      orderId: 123,
      slot: undefined
    });
    resolveOldOrder({ id: 123, status: 1, is_maker: true } as OrderDto);
    const oldResult = await oldRequest;

    expect(authFailure).toMatchObject({ status: "failed", failure: { kind: "authentication" } });
    expect(oldResult).toEqual({ status: "unchanged", order: undefined });
    expect(useOrderStore.getState()).toMatchObject({
      order: undefined,
      orderIdentity: undefined,
      loading: false,
      refreshing: false
    });
  });

  it("exposes a transient cold-load failure without blaming the coordinator", async () => {
    fetchOrderMock.mockRejectedValue(new Error("Tor could not open the private destination"));

    const result = await useOrderStore.getState().loadOrder({ coordinator, orderId: 123, slot });

    expect(result).toEqual({
      status: "failed",
      failure: {
        kind: "transient",
        message: "The trade is taking longer to open."
      }
    });
    expect(useOrderStore.getState()).toMatchObject({
      order: undefined,
      loading: false,
      refreshing: false,
      loadFailure: result.status === "failed" ? result.failure : undefined,
      actionError: undefined
    });
  });

  it("preserves a cached order and suppresses its transient refresh failure", async () => {
    const cachedOrder = {
      id: 123,
      shortAlias: coordinator.shortAlias,
      status: 2,
      is_maker: true
    } as OrderDto;
    useOrderStore.setState({ order: cachedOrder });
    fetchOrderMock.mockRejectedValue(new Error("The request took too long. Please try again."));

    const result = await useOrderStore.getState().loadOrder({ coordinator, orderId: 123, slot });

    expect(result).toMatchObject({ status: "failed", failure: { kind: "transient" } });
    expect(useOrderStore.getState()).toMatchObject({
      order: cachedOrder,
      loading: false,
      refreshing: false,
      loadFailure: undefined
    });
  });

  it("clears the load failure when a retry recovers", async () => {
    fetchOrderMock
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce({ id: 123, status: 3, is_maker: false, is_taker: true });

    const failed = await useOrderStore.getState().loadOrder({ coordinator, orderId: 123, slot });
    const recovered = await useOrderStore.getState().loadOrder({
      coordinator,
      orderId: 123,
      reason: "manual",
      slot
    });

    expect(failed).toMatchObject({ status: "failed", failure: { kind: "transient" } });
    expect(recovered).toMatchObject({
      status: "loaded",
      order: { id: 123, status: 3, shortAlias: coordinator.shortAlias }
    });
    expect(useOrderStore.getState()).toMatchObject({
      order: recovered.status === "loaded" ? recovered.order : undefined,
      loadFailure: undefined,
      loading: false,
      refreshing: false
    });
  });

  it("keeps action errors separate from load failures", async () => {
    submitOrderActionMock.mockRejectedValue(new Error("The action was rejected."));

    await useOrderStore.getState().submitAction({
      coordinator,
      orderId: 123,
      slot,
      payload: { action: "pause" }
    });

    expect(useOrderStore.getState()).toMatchObject({
      actionError: "The action was rejected.",
      loadFailure: undefined
    });
  });
});

describe("order load failure classification", () => {
  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [404, "not-found"],
    [500, "transient"],
    [503, "transient"],
    [400, "terminal"],
    [429, "terminal"]
  ] as const)("classifies HTTP %i before inspecting its message", (status, kind) => {
    const error = new RoboSatsApiError(
      status,
      { detail: "The request timed out while Tor was temporarily unavailable." },
      "Request failed"
    );

    expect(classifyOrderLoadFailure(error).kind).toBe(kind);
  });

  it.each([
    Object.assign(new Error("cancelled"), { name: "AbortError" }),
    Object.assign(new Error("offline"), { name: "NetworkError" }),
    new Error("Tor bootstrap failed"),
    new Error("SOCKS connection failed"),
    new Error("The connection was reset")
  ])("classifies generic transport failure %# as transient", (error) => {
    expect(classifyOrderLoadFailure(error).kind).toBe("transient");
  });

  it("keeps unrelated failures terminal", () => {
    expect(classifyOrderLoadFailure(new Error("This robot cannot access the order.")).kind).toBe("terminal");
  });
});

describe("confirmed-order handoff", () => {
  it("matches only the exact endpoint, slot, coordinator, and order identity", () => {
    const identity = {
      coordinatorEndpoint: coordinator.url,
      slotId: slot.tokenSHA256,
      shortAlias: coordinator.shortAlias,
      orderId: 123
    };

    expect(orderLoadIdentityMatches(identity, identity)).toBe(true);
    expect(orderLoadIdentityMatches(identity, { ...identity, coordinatorEndpoint: "https://other.example" })).toBe(false);
    expect(orderLoadIdentityMatches(identity, { ...identity, slotId: "other-slot" })).toBe(false);
    expect(orderLoadIdentityMatches(identity, { ...identity, shortAlias: "temple" })).toBe(false);
    expect(orderLoadIdentityMatches(identity, { ...identity, orderId: 456 })).toBe(false);
    expect(orderLoadIdentityMatches(undefined, identity)).toBe(false);
  });

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

    useOrderStore.getState().primeOrder(confirmedOrder, {
      coordinatorEndpoint: coordinator.url,
      slotId: slot.tokenSHA256,
      shortAlias: coordinator.shortAlias,
      orderId: confirmedOrder.id
    });
    resolveOldOrder({ id: 123, status: 1, is_maker: true } as OrderDto);
    const result = await oldRequest;

    expect(result).toEqual({ status: "unchanged", order: confirmedOrder });
    expect(useOrderStore.getState().order).toBe(confirmedOrder);
    expect(useOrderStore.getState().orderIdentity).toEqual({
      coordinatorEndpoint: coordinator.url,
      slotId: slot.tokenSHA256,
      shortAlias: coordinator.shortAlias,
      orderId: confirmedOrder.id
    });
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
