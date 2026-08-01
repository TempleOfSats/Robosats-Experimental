// @vitest-environment happy-dom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { type RobotSlot, useGarageStore } from "@/domains/garage/garageStore";
import { resetOrderFeedbackVisibilityForTests } from "@/domains/notifications/orderFeedbackVisibility";
import { resetCoordinatorOrderActivityForTests } from "@/domains/orders/orderActivity";
import { resetOrderChangeNotificationsForTests } from "@/domains/orders/orderChangeNotifications";
import { resetOrderLoadRecoveryForTests } from "@/domains/orders/orderLoadRecovery";
import { OrderPage } from "@/domains/orders/OrderPage";
import { useOrderStore } from "@/domains/orders/orderStore";
import { defaultProPreferences, useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import { coordinatorRequestScheduler } from "@/domains/transport/requestScheduler";
import { resetRefreshIntentLifecycleForTests } from "@/domains/transport/refreshIntents";
import { resetTransportHealthForTests } from "@/domains/transport/transportHealth";

type TransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

const { transportRequestMock } = vi.hoisted(() => ({
  transportRequestMock: vi.fn()
}));

vi.mock("@/domains/transport/androidBridge", () => ({
  getNativeTorDiagnostics: vi.fn(async () => null),
  isAndroidApp: () => false,
  isIOSApp: () => false,
  isNativeApp: () => false,
  nativeAppBridge: () => undefined,
  requestNativeTorReconnect: () => false,
  transportRequest: transportRequestMock
}));

let container: HTMLDivElement;
let root: Root | undefined;
let previousActEnvironment: boolean | undefined;
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

beforeEach(() => {
  previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  transportRequestMock.mockReset();
  coordinatorRequestScheduler.resetForTests();
  resetRefreshIntentLifecycleForTests();
  resetTransportHealthForTests();
  resetOrderChangeNotificationsForTests();
  resetOrderLoadRecoveryForTests();
  resetCoordinatorOrderActivityForTests();
  resetOrderFeedbackVisibilityForTests();
  useFederationStore.setState({ coordinators: [coordinator] });
  useGarageStore.setState({ slots: [slot], currentToken: slot.token, hydrated: true });
  useProPreferencesStore.setState(defaultProPreferences);
  useOrderStore.getState().clearOrder();
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = undefined;
  }
  container.remove();
  coordinatorRequestScheduler.resetForTests();
  resetRefreshIntentLifecycleForTests();
  resetTransportHealthForTests();
  resetOrderChangeNotificationsForTests();
  resetOrderLoadRecoveryForTests();
  resetCoordinatorOrderActivityForTests();
  resetOrderFeedbackVisibilityForTests();
  useOrderStore.getState().clearOrder();
  vi.restoreAllMocks();
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("OrderPage load freshness", () => {
  it("reuses the StrictMode load but starts a fresh final read for A to B to A", async () => {
    const pending: Array<{ resolve: (response: TransportResponse) => void; url: string }> = [];
    transportRequestMock.mockImplementation(
      (url: string) =>
        new Promise<TransportResponse>((resolve) => {
          pending.push({ resolve, url });
        })
    );

    await renderOrder(123);
    await vi.waitFor(() => expect(transportRequestMock).toHaveBeenCalledOnce());
    await renderOrder(124);
    await vi.waitFor(() => expect(transportRequestMock).toHaveBeenCalledTimes(2));
    await renderOrder(123);
    await vi.waitFor(() => expect(transportRequestMock).toHaveBeenCalledTimes(3));

    expect(pending.map(({ url }) => url)).toEqual([
      `${coordinator.url}/api/order/?order_id=123`,
      `${coordinator.url}/api/order/?order_id=124`,
      `${coordinator.url}/api/order/?order_id=123`
    ]);

    await act(async () => root?.unmount());
    root = undefined;
    pending[1].resolve(orderResponse(124, 8));
    pending[0].resolve(orderResponse(123, 7));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useOrderStore.getState().order).toBeUndefined();

    pending[2].resolve(orderResponse(123, 3));
    await vi.waitFor(() => {
      expect(useOrderStore.getState().order).toMatchObject({
        id: 123,
        status: 3,
        shortAlias: coordinator.shortAlias
      });
    });
  });
});

async function renderOrder(orderId: number): Promise<void> {
  await act(async () => {
    root?.render(
      <StrictMode>
        <MemoryRouter>
          <OrderPage embeddedLocator={{ shortAlias: coordinator.shortAlias, orderId }} />
        </MemoryRouter>
      </StrictMode>
    );
  });
}

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
