import { afterEach, describe, expect, it } from "vitest";
import type { RobotSlot } from "@/domains/garage/garageStore";
import {
  reserveRobotOrderAction,
  resetRobotOrderReservationsForTests
} from "@/domains/garage/robotAvailability";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import type { OrderDto } from "@/domains/orders/order.types";
import { deriveProRobotLifecycle } from "@/domains/pro/proRobotLifecycle";
import type { ProTradeSnapshot, SlotSyncState } from "@/domains/pro/pro.types";

afterEach(resetRobotOrderReservationsForTests);

describe("PRO robot lifecycle", () => {
  it("treats locally generated and coordinator-verified idle robots as ready", () => {
    const slot = robotSlot();

    expect(deriveProRobotLifecycle(slot, {}, sync({ locallyReadyAt: 10 }))).toMatchObject({
      status: "ready",
      verification: "local",
      canStartOrder: true,
      canRemove: true,
      canOpenTrade: false
    });
    expect(deriveProRobotLifecycle(slot, {}, sync({ lastSuccessAt: 20 }))).toMatchObject({
      status: "ready",
      verification: "coordinator",
      canStartOrder: true,
      canRemove: true
    });
  });

  it("keeps an idle robot usable while transport verification is unresolved", () => {
    const slot = robotSlot();

    expect(deriveProRobotLifecycle(slot, {}, sync({ inFlight: true })).status).toBe("checking");
    expect(deriveProRobotLifecycle(slot, {}, sync({
      attemptedCoordinators: 0,
      lastAttemptAt: 10
    })).status).toBe("waiting");
    expect(deriveProRobotLifecycle(slot, {}, sync({
      attemptedCoordinators: 2,
      error: "refresh-failed",
      lastAttemptAt: 10
    }))).toMatchObject({
      status: "unavailable",
      canStartOrder: true,
      canRemove: true
    });
  });

  it("blocks duplicate actions while a robot is starting an order", () => {
    const slot = robotSlot();
    const release = reserveRobotOrderAction(slot.tokenSHA256);

    expect(deriveProRobotLifecycle(slot, {})).toMatchObject({
      status: "starting",
      canStartOrder: false,
      canRemove: false
    });
    release?.();
    expect(deriveProRobotLifecycle(slot, {})).toMatchObject({
      status: "checking",
      canStartOrder: true
    });
  });

  it("prioritizes actionable and ongoing work over transport state", () => {
    const slot = robotSlot();
    const unavailable = sync({
      attemptedCoordinators: 2,
      error: "refresh-failed",
      lastAttemptAt: 10
    });

    expect(deriveProRobotLifecycle(slot, {
      actionable: snapshot(slot, { status: 6, is_buyer: true, is_seller: false })
    }, unavailable)).toMatchObject({
      status: "needs-attention",
      canStartOrder: false,
      canRemove: false,
      canOpenTrade: true
    });
    expect(deriveProRobotLifecycle(slot, {
      ongoing: snapshot(slot, { status: 1, is_maker: true })
    }, unavailable)).toMatchObject({
      status: "ongoing",
      canStartOrder: false,
      canRemove: false,
      canOpenTrade: true
    });
  });

  it("identifies paused and renewable offers in the robot status", () => {
    const slot = robotSlot();

    expect(deriveProRobotLifecycle(slot, {
      paused: snapshot(slot, { status: 2, is_maker: true })
    })).toMatchObject({
      status: "renewable",
      statusLabel: "Renewable trade",
      canStartOrder: false,
      canRemove: false,
      canOpenTrade: true
    });
    expect(deriveProRobotLifecycle(slot, {
      expired: {
        ...snapshot(slot, { status: 5, is_maker: true }),
        renewable: true
      }
    })).toMatchObject({
      status: "renewable",
      statusLabel: "Renewable trade",
      canOpenTrade: true
    });
  });

  it("does not call a robot ready while its restored last order is unresolved", () => {
    const slot = robotSlot();
    const locator = {
      slotId: slot.tokenSHA256,
      shortAlias: "lake",
      orderId: 42
    };
    const pending: ProTradeSnapshot = {
      key: `${slot.tokenSHA256}:lake:42`,
      locator,
      nickname: slot.nickname,
      hashId: slot.hashId,
      lastOrderId: 42,
      renewable: false,
      released: false,
      freshness: "refreshing"
    };

    expect(deriveProRobotLifecycle(slot, { pending })).toMatchObject({
      status: "checking",
      statusLabel: "Checking last order",
      canStartOrder: false,
      canRemove: false,
      canOpenTrade: false
    });
    expect(deriveProRobotLifecycle(slot, {
      pending: { ...pending, freshness: "error", errorCode: "order-unavailable" }
    })).toMatchObject({
      status: "unavailable",
      statusLabel: "Order status unavailable",
      canStartOrder: false,
      canRemove: false,
      canOpenTrade: false
    });
  });
});

function robotSlot(): RobotSlot {
  const identity = deriveRobotIdentity("pro-lifecycle-token".padEnd(40, "x"));
  return {
    ...identity,
    nickname: "LifecycleRobot",
    earnedRewards: 0,
    robots: {
      local: {
        token: identity.token,
        shortAlias: "local",
        tokenSHA256: identity.tokenSHA256,
        nostrPubKey: identity.nostrPubKey
      }
    }
  };
}

function sync(overrides: Partial<SlotSyncState>): SlotSyncState {
  return {
    slotId: robotSlot().tokenSHA256,
    epoch: 0,
    inFlight: false,
    ...overrides
  };
}

function snapshot(slot: RobotSlot, overrides: Partial<OrderDto>): ProTradeSnapshot {
  const order = {
    id: 1,
    status: 9,
    type: 0,
    amount: 100,
    currency: 1,
    payment_method: "SEPA",
    premium: 0,
    satoshis: 1000,
    is_maker: false,
    is_taker: true,
    is_buyer: true,
    is_seller: false,
    maker_nick: "Maker",
    maker_hash_id: "maker",
    taker_nick: "Taker",
    taker_hash_id: "taker",
    bond_invoice: "",
    bond_satoshis: 0,
    escrow_invoice: "",
    escrow_satoshis: 0,
    invoice_amount: 0,
    swap_allowed: false,
    suggested_mining_fee_rate: 0,
    swap_fee_rate: 0,
    expires_at: "2026-07-23T12:00:00Z",
    shortAlias: "lake",
    ...overrides
  } satisfies OrderDto;
  return {
    key: `${slot.tokenSHA256}:lake:${order.id}`,
    locator: { slotId: slot.tokenSHA256, shortAlias: "lake", orderId: order.id },
    nickname: slot.nickname,
    hashId: slot.hashId,
    order,
    renewable: false,
    released: false,
    freshness: "fresh"
  };
}
