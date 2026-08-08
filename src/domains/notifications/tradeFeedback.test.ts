import { beforeEach, describe, expect, it, vi } from "vitest";

const playTradeAudioMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const showDesktopOrderNotificationMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));

vi.mock("@/domains/audio/audioController", () => ({
  playTradeAudio: playTradeAudioMock
}));
vi.mock("@/domains/notifications/desktopNotifications", () => ({
  showDesktopOrderNotification: showDesktopOrderNotificationMock
}));
vi.mock("@/domains/notifications/orderFeedbackVisibility", () => ({
  shouldPlayOrderFeedbackAudio: () => true
}));

import { deliverChatFeedback, resetTradeFeedbackForTests } from "@/domains/notifications/tradeFeedback";

beforeEach(() => {
  resetTradeFeedbackForTests();
  playTradeAudioMock.mockClear();
  showDesktopOrderNotificationMock.mockClear();
});

describe("trade chat feedback", () => {
  it("deduplicates a replayed message index", () => {
    deliver(7);
    deliver(7);

    expect(playTradeAudioMock).toHaveBeenCalledOnce();
    expect(showDesktopOrderNotificationMock).toHaveBeenCalledOnce();
  });

  it("reports every new message index even when messages arrive close together", () => {
    deliver(7);
    deliver(8);

    expect(playTradeAudioMock).toHaveBeenCalledTimes(2);
    expect(showDesktopOrderNotificationMock).toHaveBeenCalledTimes(2);
  });

  it("isolates the same coordinator order identifier by local robot", () => {
    deliver(7, "robot-a");
    deliver(7, "robot-b");

    expect(playTradeAudioMock).toHaveBeenCalledTimes(2);
    expect(showDesktopOrderNotificationMock).toHaveBeenCalledTimes(2);
  });
});

function deliver(lastIndex: number, robotHashId = "robot"): void {
  deliverChatFeedback({
    lastIndex,
    orderId: 123,
    peerName: "Peer",
    robotHashId,
    shortAlias: "lake"
  });
}
