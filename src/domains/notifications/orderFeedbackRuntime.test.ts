import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotSlot } from "@/domains/garage/garageStore";
import {
  ingestCoordinatorOrder,
  resetCoordinatorOrderActivityForTests
} from "@/domains/orders/orderActivity";
import type { OrderDto } from "@/domains/orders/order.types";

const playTradeAudioMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const showDesktopOrderNotificationMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));

vi.mock("@/domains/audio/audioController", () => ({
  playTradeAudio: playTradeAudioMock
}));
vi.mock("@/domains/notifications/desktopNotifications", () => ({
  showDesktopOrderNotification: showDesktopOrderNotificationMock
}));

import {
  startOrderFeedbackRuntime,
  stopOrderFeedbackRuntimeForTests
} from "@/domains/notifications/orderFeedbackRuntime";
import { resetTradeFeedbackForTests } from "@/domains/notifications/tradeFeedback";
import { useGarageStore } from "@/domains/garage/garageStore";

beforeEach(() => {
  stopOrderFeedbackRuntimeForTests();
  resetCoordinatorOrderActivityForTests();
  resetTradeFeedbackForTests();
  playTradeAudioMock.mockClear();
  showDesktopOrderNotificationMock.mockClear();
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  });
  useGarageStore.setState({ slots: [slot], currentToken: slot.token, hydrated: true });
});

describe("desktop trade feedback", () => {
  it("seeds current state and reports each material change once", () => {
    startOrderFeedbackRuntime();
    observe({ status: 1, chat_last_index: 2 });
    expect(showDesktopOrderNotificationMock).not.toHaveBeenCalled();

    observe({ status: 2, chat_last_index: 2 });
    observe({ status: 2, chat_last_index: 2 });
    expect(playTradeAudioMock).toHaveBeenCalledOnce();
    expect(showDesktopOrderNotificationMock).toHaveBeenCalledOnce();
    expect(showDesktopOrderNotificationMock).toHaveBeenLastCalledWith(123, "lake", "Taker found");

    observe({ status: 2, chat_last_index: 3 });
    expect(playTradeAudioMock).toHaveBeenLastCalledWith("chat-open");
    expect(showDesktopOrderNotificationMock).toHaveBeenLastCalledWith(
      123,
      "lake",
      "New trade chat message"
    );

    observe({ status: 2, chat_last_index: 3, pending_cancel: true });
    expect(showDesktopOrderNotificationMock).toHaveBeenLastCalledWith(
      123,
      "lake",
      "Your peer requested collaborative cancellation"
    );
  });

  it("ignores provisional observations", () => {
    startOrderFeedbackRuntime();
    observe({ status: 1 }, false);
    observe({ status: 2 }, false);
    expect(playTradeAudioMock).not.toHaveBeenCalled();
    expect(showDesktopOrderNotificationMock).not.toHaveBeenCalled();
  });
});

function observe(order: Partial<OrderDto>, authoritative = true): void {
  ingestCoordinatorOrder({
    authoritative,
    order: {
      id: 123,
      is_maker: true,
      is_taker: false,
      shortAlias: "lake",
      ...order
    } as OrderDto,
    shortAlias: "lake",
    slot
  });
}

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
