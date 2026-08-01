import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { type RobotSlot, useGarageStore } from "@/domains/garage/garageStore";
import { resetOrderChangeNotificationsForTests } from "@/domains/orders/orderChangeNotifications";
import {
  discardColdOrderLoad,
  registerOrderLoadRecovery,
  resetOrderLoadRecoveryForTests
} from "@/domains/orders/orderLoadRecovery";
import { type OrderLoadResult, useOrderStore } from "@/domains/orders/orderStore";
import { coordinatorRequestScheduler } from "@/domains/transport/requestScheduler";
import { resetRefreshIntentLifecycleForTests } from "@/domains/transport/refreshIntents";

type TransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

const { transportRequestMock } = vi.hoisted(() => ({
  transportRequestMock: vi.fn()
}));

vi.mock("@/domains/transport/androidBridge", () => ({
  isAndroidApp: () => false,
  isIOSApp: () => false,
  isNativeApp: () => false,
  transportRequest: transportRequestMock
}));

let windowTarget: EventTarget & Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
let documentTarget: EventTarget & {
  hidden: boolean;
  visibilityState: DocumentVisibilityState;
};

beforeEach(() => {
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
  transportRequestMock.mockReset();
  coordinatorRequestScheduler.resetForTests();
  resetRefreshIntentLifecycleForTests();
  resetOrderChangeNotificationsForTests();
  resetOrderLoadRecoveryForTests();
  useGarageStore.setState({ slots: [slot], currentToken: slot.token, hydrated: true });
  useOrderStore.getState().clearOrder();
});

afterEach(() => {
  coordinatorRequestScheduler.resetForTests();
  resetRefreshIntentLifecycleForTests();
  resetOrderChangeNotificationsForTests();
  resetOrderLoadRecoveryForTests();
  useOrderStore.getState().clearOrder();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("order load freshness across transport coalescing", () => {
  it("keeps the final A read independent during an A to B to A transition", async () => {
    const pending: Array<{ resolve: (response: TransportResponse) => void; url: string }> = [];
    transportRequestMock.mockImplementation(
      (url: string) =>
        new Promise<TransportResponse>((resolve) => {
          pending.push({ resolve, url });
        })
    );
    const loads: Array<Promise<OrderLoadResult>> = [];
    const locatorA = { slotId: slot.tokenSHA256, shortAlias: coordinator.shortAlias, orderId: 123 };
    const locatorB = { ...locatorA, orderId: 124 };
    const register = (locator: typeof locatorA, independentInitialRead = false) =>
      registerOrderLoadRecovery({
        coordinatorEndpoint: coordinator.url,
        locator,
        load: (reason) => {
          const load = useOrderStore.getState().loadOrder({
            coordinator,
            independentRead: independentInitialRead && reason === "initial",
            orderId: locator.orderId,
            reason,
            slot
          });
          loads.push(load);
          return load;
        },
        onPhaseChange: vi.fn()
      });
    const replace = (current: ReturnType<typeof registerOrderLoadRecovery>, locator: typeof locatorA) => {
      current.dispose();
      const independentInitialRead = discardColdOrderLoad(coordinator.url, locator);
      useOrderStore.getState().clearOrder();
      return register(locator, independentInitialRead);
    };

    const firstA = register(locatorA);
    await vi.waitFor(() => expect(transportRequestMock).toHaveBeenCalledOnce());
    const currentB = replace(firstA, locatorB);
    await vi.waitFor(() => expect(transportRequestMock).toHaveBeenCalledTimes(2));
    const finalA = replace(currentB, locatorA);

    await vi.waitFor(() => expect(transportRequestMock).toHaveBeenCalledTimes(3));
    pending[1].resolve(orderResponse(124, 8));
    await expect(loads[1]).resolves.toMatchObject({ status: "unchanged" });

    expect(pending.map(({ url }) => url)).toEqual([
      `${coordinator.url}/api/order/?order_id=123`,
      `${coordinator.url}/api/order/?order_id=124`,
      `${coordinator.url}/api/order/?order_id=123`
    ]);
    pending[0].resolve(orderResponse(123, 7));
    await expect(loads[0]).resolves.toMatchObject({ status: "unchanged" });
    expect(useOrderStore.getState().order).toBeUndefined();

    pending[2].resolve(orderResponse(123, 3));
    await expect(loads[2]).resolves.toMatchObject({
      status: "loaded",
      order: { id: 123, status: 3, shortAlias: coordinator.shortAlias }
    });
    expect(useOrderStore.getState().order).toMatchObject({
      id: 123,
      status: 3,
      shortAlias: coordinator.shortAlias
    });
    finalA.dispose();
  });
});

function orderResponse(orderId: number, status: number): TransportResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: orderId, status, is_maker: true, is_taker: false })
  };
}

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
  token: "test-robot-token",
  hashId: "test-hash",
  tokenSHA256: "test-token-sha",
  nostrPubKey: "test-nostr-public",
  nostrSecKey: new Uint8Array(),
  entropyBits: 100,
  hasEnoughEntropy: true,
  shannonEntropy: 4,
  nickname: "Test Robot",
  activeOrderId: 123,
  lastOrderId: 123,
  earnedRewards: 0,
  robots: {
    lake: {
      token: "test-robot-token",
      tokenSHA256: "test-token-sha",
      nostrPubKey: "test-nostr-public",
      activeOrderId: 123,
      lastOrderId: 123,
      earnedRewards: 0
    }
  }
};
