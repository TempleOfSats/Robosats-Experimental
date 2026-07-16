import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotSlot } from "@/domains/garage/garageStore";
import type { OrderDto } from "@/domains/orders/order.types";

const submitOrderActionMock = vi.hoisted(() => vi.fn());
const fetchOrderMock = vi.hoisted(() => vi.fn());

vi.mock("@/domains/orders/orderApi", () => ({
  fetchOrder: fetchOrderMock,
  submitOrderAction: submitOrderActionMock
}));

import { useGarageStore } from "@/domains/garage/garageStore";
import { useOrderStore } from "@/domains/orders/orderStore";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  submitOrderActionMock.mockReset();
  fetchOrderMock.mockReset();
  useGarageStore.setState({ slots: [slot], currentToken: slot.token, hydrated: true });
  useOrderStore.getState().clearOrder();
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
