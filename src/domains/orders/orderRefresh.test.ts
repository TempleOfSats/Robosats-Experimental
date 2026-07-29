import { describe, expect, it } from "vitest";
import {
  orderRefreshDelayMs,
  jitterDelay,
  shouldDismissEmbeddedTrade,
  shouldLeaveTradeAfterAction,
  shouldOpenOrderDetailsByDefault,
  shouldReturnExpiredTakeToOffers
} from "@/domains/orders/OrderPage";
import { isAlreadyCancelledError, isTransientOrderLoadError } from "@/domains/orders/orderStore";
import { RoboSatsApiError } from "@/domains/transport/apiError";

describe("orderRefreshDelayMs", () => {
  it("keeps time-sensitive bond and escrow stages responsive", () => {
    expect(orderRefreshDelayMs(0)).toBe(3_000);
    expect(orderRefreshDelayMs(6)).toBe(8_000);
    expect(orderRefreshDelayMs(9)).toBe(10_000);
  });

  it("backs off after terminal and dispute states", () => {
    expect(orderRefreshDelayMs(14)).toBe(60_000);
    expect(orderRefreshDelayMs(16)).toBe(300_000);
  });

  it("keeps polling jitter within the configured range", () => {
    expect(jitterDelay(10_000, 0.1, () => 0)).toBe(9_000);
    expect(jitterDelay(10_000, 0.1, () => 0.5)).toBe(10_000);
    expect(jitterDelay(10_000, 0.1, () => 1)).toBe(11_000);
  });
});

describe("shouldReturnExpiredTakeToOffers", () => {
  it("leaves a take flow when an unlocked taker attempt returns to the public book", () => {
    expect(shouldReturnExpiredTakeToOffers(3, true, { status: 1, is_maker: false })).toBe(true);
  });

  it("does not redirect the maker or unrelated public-order loads", () => {
    expect(shouldReturnExpiredTakeToOffers(3, false, { status: 1, is_maker: false })).toBe(false);
    expect(shouldReturnExpiredTakeToOffers(3, true, { status: 1, is_maker: true })).toBe(false);
    expect(shouldReturnExpiredTakeToOffers(undefined, true, { status: 1, is_maker: false })).toBe(false);
  });
});

describe("shouldLeaveTradeAfterAction", () => {
  it("keeps the first peer in chat while collaborative cancellation awaits acceptance", () => {
    expect(shouldLeaveTradeAfterAction("collaborative-cancel", { status: 9, is_maker: false, is_taker: true })).toBe(false);
  });

  it("leaves after terminal cancellation or an early take is released", () => {
    expect(shouldLeaveTradeAfterAction("collaborative-cancel", { status: 12, is_maker: false, is_taker: true })).toBe(true);
    expect(shouldLeaveTradeAfterAction("cancel", { status: 4, is_maker: false, is_taker: false })).toBe(true);
    expect(shouldLeaveTradeAfterAction("cancel", { status: 1, is_maker: false, is_taker: false })).toBe(true);
  });
});

describe("shouldDismissEmbeddedTrade", () => {
  it("keeps terminal results visible in the Pro Desk modal", () => {
    expect(shouldDismissEmbeddedTrade({ status: 4, is_maker: true, is_taker: false })).toBe(false);
    expect(shouldDismissEmbeddedTrade({ status: 12, is_maker: false, is_taker: true })).toBe(false);
  });

  it("dismisses only when an unlocked take returns to the public book", () => {
    expect(shouldDismissEmbeddedTrade({ status: 1, is_maker: false, is_taker: false })).toBe(true);
    expect(shouldDismissEmbeddedTrade({ status: 1, is_maker: true, is_taker: false })).toBe(false);
  });
});

describe("shouldOpenOrderDetailsByDefault", () => {
  it("opens details for a maker with a public or paused order", () => {
    expect(shouldOpenOrderDetailsByDefault({ status: 1, is_maker: true })).toBe(true);
    expect(shouldOpenOrderDetailsByDefault({ status: 2, is_maker: true })).toBe(true);
  });

  it("opens details while either peer is waiting for escrow or payout setup", () => {
    expect(shouldOpenOrderDetailsByDefault({ status: 7, is_maker: true })).toBe(true);
    expect(shouldOpenOrderDetailsByDefault({ status: 7, is_maker: false })).toBe(true);
    expect(shouldOpenOrderDetailsByDefault({ status: 8, is_maker: true })).toBe(true);
    expect(shouldOpenOrderDetailsByDefault({ status: 8, is_maker: false })).toBe(true);
  });

  it("keeps details collapsed for takers and other trade stages", () => {
    expect(shouldOpenOrderDetailsByDefault({ status: 1, is_maker: false })).toBe(false);
    expect(shouldOpenOrderDetailsByDefault({ status: 2, is_maker: false })).toBe(false);
    expect(shouldOpenOrderDetailsByDefault({ status: 3, is_maker: true })).toBe(false);
  });
});

describe("isAlreadyCancelledError", () => {
  it("accepts coordinator error 1043 as terminal cancellation", () => {
    expect(isAlreadyCancelledError(new Error('RoboSats API 400: {"error_code":1043,"bad_request":"This order has been cancelled"}'))).toBe(true);
    expect(isAlreadyCancelledError(new RoboSatsApiError(
      400,
      { error_code: 1043, bad_request: "Localized coordinator response" },
      "Request failed"
    ))).toBe(true);
  });

  it("does not swallow unrelated coordinator errors", () => {
    expect(isAlreadyCancelledError(new Error('RoboSats API 400: {"error_code":1021}'))).toBe(false);
  });
});

describe("isTransientOrderLoadError", () => {
  it("recognizes Tor timeouts and temporary coordinator failures", () => {
    expect(isTransientOrderLoadError(new Error("The request took too long. Please try again."))).toBe(true);
    expect(isTransientOrderLoadError(new Error("The coordinator is temporarily unavailable."))).toBe(true);
  });

  it("does not hide validation failures", () => {
    expect(isTransientOrderLoadError(new Error("This robot cannot access the order."))).toBe(false);
  });
});
