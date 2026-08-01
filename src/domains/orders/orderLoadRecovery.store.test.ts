import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotSlot } from "@/domains/garage/garageStore";
import type { OrderDto } from "@/domains/orders/order.types";
import {
  discardColdOrderLoad,
  isColdOrderLoadActive,
  registerOrderLoadRecovery,
  resetOrderLoadRecoveryForTests
} from "@/domains/orders/orderLoadRecovery";
import { resetOrderChangeNotificationsForTests } from "@/domains/orders/orderChangeNotifications";
import { type OrderLoadResult, useOrderStore } from "@/domains/orders/orderStore";
import { resetRefreshIntentLifecycleForTests } from "@/domains/transport/refreshIntents";

const fetchOrderMock = vi.hoisted(() => vi.fn());

vi.mock("@/domains/orders/orderApi", () => ({
  fetchOrder: fetchOrderMock,
  isCompleteOrderActionResponse: vi.fn(() => true),
  submitOrderAction: vi.fn()
}));

let windowTarget: EventTarget & Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
let documentTarget: EventTarget & {
  hidden: boolean;
  visibilityState: DocumentVisibilityState;
};

beforeEach(() => {
  vi.useFakeTimers();
  windowTarget = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  });
  documentTarget = Object.assign(new EventTarget(), {
    hidden: false,
    visibilityState: "visible" as DocumentVisibilityState
  });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn()
  });
  fetchOrderMock.mockReset();
  resetRefreshIntentLifecycleForTests();
  resetOrderChangeNotificationsForTests();
  resetOrderLoadRecoveryForTests();
  useOrderStore.getState().clearOrder();
});

afterEach(() => {
  resetRefreshIntentLifecycleForTests();
  resetOrderChangeNotificationsForTests();
  resetOrderLoadRecoveryForTests();
  useOrderStore.getState().clearOrder();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("order load recovery with the order store", () => {
  it("preserves the shared store request across an immediate same-locator replacement", async () => {
    let resolveFetch!: (order: OrderDto) => void;
    fetchOrderMock.mockReturnValue(
      new Promise<OrderDto>((resolve) => {
        resolveFetch = resolve;
      })
    );
    const locator = {
      slotId: slot.tokenSHA256,
      shortAlias: coordinator.shortAlias,
      orderId: 123
    };
    let firstLoad: Promise<OrderLoadResult> | undefined;
    const load = vi.fn((reason) => {
      const result = useOrderStore.getState().loadOrder({
        coordinator,
        orderId: locator.orderId,
        reason,
        slot
      });
      firstLoad ??= result;
      return result;
    });
    const first = registerOrderLoadRecovery({
      coordinatorEndpoint: coordinator.url,
      locator,
      load,
      onPhaseChange: vi.fn()
    });

    first.dispose();
    if (!isColdOrderLoadActive(coordinator.url, locator)) {
      useOrderStore.getState().clearOrder();
    }
    const second = registerOrderLoadRecovery({
      coordinatorEndpoint: coordinator.url,
      locator,
      load,
      onPhaseChange: vi.fn()
    });

    expect(load).toHaveBeenCalledOnce();
    expect(fetchOrderMock).toHaveBeenCalledOnce();
    resolveFetch({ id: 123, status: 3, is_maker: false, is_taker: true } as OrderDto);
    await expect(firstLoad).resolves.toMatchObject({
      status: "loaded",
      order: { id: 123, shortAlias: coordinator.shortAlias }
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(load).toHaveBeenCalledOnce();
    expect(useOrderStore.getState().order).toMatchObject({
      id: 123,
      shortAlias: coordinator.shortAlias
    });
    second.dispose();
  });

  it.each(["endpoint", "slot"] as const)(
    "prevents an old response from applying after the %s identity changes",
    async (changedIdentity) => {
      const resolvers: Array<(order: OrderDto) => void> = [];
      fetchOrderMock.mockImplementation(
        () =>
          new Promise<OrderDto>((resolve) => {
            resolvers.push(resolve);
          })
      );
      const nextCoordinator =
        changedIdentity === "endpoint"
          ? { ...coordinator, url: "https://replacement-coordinator.example" }
          : coordinator;
      const nextSlot = changedIdentity === "slot" ? alternateSlot : slot;
      const firstLocator = {
        slotId: slot.tokenSHA256,
        shortAlias: coordinator.shortAlias,
        orderId: 123
      };
      const nextLocator = {
        slotId: nextSlot.tokenSHA256,
        shortAlias: nextCoordinator.shortAlias,
        orderId: 123
      };
      let firstLoad!: Promise<OrderLoadResult>;
      const first = registerOrderLoadRecovery({
        coordinatorEndpoint: coordinator.url,
        locator: firstLocator,
        load: (reason) => {
          firstLoad = useOrderStore.getState().loadOrder({
            coordinator,
            orderId: firstLocator.orderId,
            reason,
            slot
          });
          return firstLoad;
        },
        onPhaseChange: vi.fn()
      });

      first.dispose();
      discardColdOrderLoad(nextCoordinator.url, nextLocator);
      useOrderStore.getState().clearOrder();

      let nextLoad!: Promise<OrderLoadResult>;
      const next = registerOrderLoadRecovery({
        coordinatorEndpoint: nextCoordinator.url,
        locator: nextLocator,
        load: (reason) => {
          nextLoad = useOrderStore.getState().loadOrder({
            coordinator: nextCoordinator,
            orderId: nextLocator.orderId,
            reason,
            slot: nextSlot
          });
          return nextLoad;
        },
        onPhaseChange: vi.fn()
      });

      expect(fetchOrderMock).toHaveBeenCalledTimes(2);
      resolvers[0]({ id: 123, status: 7, is_maker: true, is_taker: false } as OrderDto);
      await expect(firstLoad).resolves.toMatchObject({ status: "unchanged" });
      expect(useOrderStore.getState().order).toBeUndefined();

      resolvers[1]({ id: 123, status: 3, is_maker: false, is_taker: true } as OrderDto);
      await expect(nextLoad).resolves.toMatchObject({
        status: "loaded",
        order: { id: 123, status: 3, shortAlias: coordinator.shortAlias }
      });
      expect(useOrderStore.getState().order).toMatchObject({
        id: 123,
        status: 3,
        shortAlias: coordinator.shortAlias
      });
      expect(useOrderStore.getState().orderIdentity).toEqual({
        coordinatorEndpoint: nextCoordinator.url,
        slotId: nextSlot.tokenSHA256,
        shortAlias: nextCoordinator.shortAlias,
        orderId: 123
      });
      next.dispose();
    }
  );

  it("does not reuse stale work during a rapid A to B to A identity change", async () => {
    const resolvers: Array<(order: OrderDto) => void> = [];
    fetchOrderMock.mockImplementation(
      () =>
        new Promise<OrderDto>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const coordinatorB = { ...coordinator, url: "https://coordinator-b.example" };
    const identityA = {
      coordinator,
      locator: {
        slotId: slot.tokenSHA256,
        shortAlias: coordinator.shortAlias,
        orderId: 123
      },
      slot
    };
    const identityB = {
      coordinator: coordinatorB,
      locator: {
        slotId: alternateSlot.tokenSHA256,
        shortAlias: coordinatorB.shortAlias,
        orderId: 123
      },
      slot: alternateSlot
    };
    const loads: Array<Promise<OrderLoadResult>> = [];
    const register = (identity: typeof identityA, independentInitialRead = false) =>
      registerOrderLoadRecovery({
        coordinatorEndpoint: identity.coordinator.url,
        locator: identity.locator,
        load: (reason) => {
          const result = useOrderStore.getState().loadOrder({
            coordinator: identity.coordinator,
            independentRead: independentInitialRead && reason === "initial",
            orderId: identity.locator.orderId,
            reason,
            slot: identity.slot
          });
          loads.push(result);
          return result;
        },
        onPhaseChange: vi.fn()
      });
    const replace = (recovery: ReturnType<typeof registerOrderLoadRecovery>, nextIdentity: typeof identityA) => {
      recovery.dispose();
      const independentInitialRead = discardColdOrderLoad(nextIdentity.coordinator.url, nextIdentity.locator);
      useOrderStore.getState().clearOrder();
      return register(nextIdentity, independentInitialRead);
    };

    const firstA = register(identityA);
    const currentB = replace(firstA, identityB);
    const finalA = replace(currentB, identityA);

    expect(fetchOrderMock).toHaveBeenCalledTimes(3);
    expect(loads).toHaveLength(3);
    expect(fetchOrderMock.mock.calls[0]?.[3]).not.toHaveProperty("supersedeInFlight");
    expect(fetchOrderMock.mock.calls[1]?.[3]).not.toHaveProperty("supersedeInFlight");
    expect(fetchOrderMock.mock.calls[2]?.[3]).toMatchObject({ supersedeInFlight: true });

    resolvers[1]({ id: 123, status: 8, is_maker: true, is_taker: false } as OrderDto);
    await expect(loads[1]).resolves.toMatchObject({ status: "unchanged" });
    expect(useOrderStore.getState().order).toBeUndefined();

    resolvers[0]({ id: 123, status: 7, is_maker: true, is_taker: false } as OrderDto);
    await expect(loads[0]).resolves.toMatchObject({ status: "unchanged" });
    expect(useOrderStore.getState().order).toBeUndefined();

    resolvers[2]({ id: 123, status: 3, is_maker: false, is_taker: true } as OrderDto);
    await expect(loads[2]).resolves.toMatchObject({
      status: "loaded",
      order: { id: 123, status: 3, shortAlias: coordinator.shortAlias }
    });
    expect(useOrderStore.getState().order).toMatchObject({
      id: 123,
      status: 3,
      shortAlias: coordinator.shortAlias
    });
    expect(useOrderStore.getState().orderIdentity).toEqual({
      coordinatorEndpoint: coordinator.url,
      slotId: slot.tokenSHA256,
      shortAlias: coordinator.shortAlias,
      orderId: 123
    });
    finalA.dispose();
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

const alternateSlot: RobotSlot = {
  ...slot,
  token: "alternate-robot-token",
  tokenSHA256: "alternate-token-sha",
  robots: {
    lake: {
      ...slot.robots.lake,
      token: "alternate-robot-token",
      tokenSHA256: "alternate-token-sha"
    }
  }
};
