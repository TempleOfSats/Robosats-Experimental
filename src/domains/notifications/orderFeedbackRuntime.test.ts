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
import {
  isTradeVisible,
  registerVisibleTrade,
  resetOrderFeedbackVisibilityForTests
} from "@/domains/notifications/orderFeedbackVisibility";
import { useGarageStore } from "@/domains/garage/garageStore";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";

beforeEach(() => {
  stopOrderFeedbackRuntimeForTests();
  resetCoordinatorOrderActivityForTests();
  resetTradeFeedbackForTests();
  resetOrderFeedbackVisibilityForTests();
  playTradeAudioMock.mockClear();
  showDesktopOrderNotificationMock.mockClear();
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  });
  useGarageStore.setState({ slots: [slot], currentToken: slot.token, hydrated: true });
  useProPreferencesStore.setState({ enabled: false });
});

describe("desktop trade feedback", () => {
  it("tracks a visible trade by Fleet slot while preserving alias-only queries", () => {
    const unregister = registerVisibleTrade("lake", 123, "slot-a");

    expect(isTradeVisible("lake", 123, "slot-a")).toBe(true);
    expect(isTradeVisible("lake", 123, "slot-b")).toBe(false);
    expect(isTradeVisible("lake", 123)).toBe(true);

    unregister();
    expect(isTradeVisible("lake", 123)).toBe(false);
  });

  it("seeds current state and reports each material change once", () => {
    startOrderFeedbackRuntime();
    observe({ status: 1, chat_last_index: 2 });
    expect(showDesktopOrderNotificationMock).not.toHaveBeenCalled();

    observe({ status: 2, chat_last_index: 2 });
    observe({ status: 2, chat_last_index: 2 });
    expect(playTradeAudioMock).toHaveBeenCalledOnce();
    expect(showDesktopOrderNotificationMock).toHaveBeenCalledOnce();
    expect(showDesktopOrderNotificationMock).toHaveBeenLastCalledWith(123, "lake", "Taker found", "hash");

    observe({ status: 2, chat_last_index: 3 });
    expect(playTradeAudioMock).toHaveBeenLastCalledWith("chat-open");
    expect(showDesktopOrderNotificationMock).toHaveBeenLastCalledWith(
      123,
      "lake",
      "New trade chat message",
      "hash"
    );

    observe({ status: 2, chat_last_index: 3, pending_cancel: true });
    expect(showDesktopOrderNotificationMock).toHaveBeenLastCalledWith(
      123,
      "lake",
      "Your peer requested collaborative cancellation",
      "hash"
    );
  });

  it("ignores provisional observations", () => {
    startOrderFeedbackRuntime();
    observe({ status: 1 }, false);
    observe({ status: 2 }, false);
    expect(playTradeAudioMock).not.toHaveBeenCalled();
    expect(showDesktopOrderNotificationMock).not.toHaveBeenCalled();
  });

  it("keeps Pro background audio quiet while retaining one desktop notification", () => {
    useProPreferencesStore.setState({ enabled: true });
    startOrderFeedbackRuntime();
    observe({ status: 1, chat_last_index: 0 });
    observe({ status: 2, chat_last_index: 0 });

    expect(playTradeAudioMock).not.toHaveBeenCalled();
    expect(showDesktopOrderNotificationMock).toHaveBeenCalledOnce();

    observe({ status: 2, chat_last_index: 1 });
    observe({ status: 2, chat_last_index: 1 });
    expect(playTradeAudioMock).not.toHaveBeenCalled();
    expect(showDesktopOrderNotificationMock).toHaveBeenCalledTimes(2);

    const unregister = registerVisibleTrade("lake", 123);
    observe({ status: 3, chat_last_index: 1 });
    expect(playTradeAudioMock).toHaveBeenCalledOnce();
    expect(showDesktopOrderNotificationMock).toHaveBeenCalledTimes(3);
    unregister();
  });

  it("reports dispute results from the current robot perspective", () => {
    startOrderFeedbackRuntime();
    observe({ status: 16, is_maker: true, is_taker: false });
    observe({ status: 18, is_maker: true, is_taker: false });
    expect(showDesktopOrderNotificationMock).toHaveBeenLastCalledWith(
      123,
      "lake",
      "Dispute resolved in your favor",
      "hash"
    );

    observe({ status: 16, is_maker: true, is_taker: false });
    observe({ status: 17, is_maker: true, is_taker: false });
    expect(showDesktopOrderNotificationMock).toHaveBeenLastCalledWith(
      123,
      "lake",
      "Dispute resolved in favor of your peer",
      "hash"
    );
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
