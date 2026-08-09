import { describe, expect, it } from "vitest";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import type { RobotSlot } from "@/domains/garage/garageStore";
import type { OrderDto } from "@/domains/orders/order.types";
import {
  classifyProTrade,
  compareProTrades,
  isResumableOrRenewableOffer,
  summarizeProRobots
} from "@/domains/pro/proSelectors";
import { hasProRobotStatusBaseline, selectOfferReadyRobots } from "@/domains/pro/proRobotLifecycle";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";
import { matchesFilter, proDeadlineTone, summaryCounts } from "@/domains/pro/proWorkspacePresentation";

describe("PRO trade selectors", () => {
  it("puts actionable work before waiting and stale trades", () => {
    const action = snapshot({ status: 6, is_buyer: true, is_seller: false });
    const waiting = snapshot({ id: 2, status: 1, is_maker: true });
    const stale = { ...snapshot({ id: 3, status: 9 }), freshness: "error" as const };

    expect(classifyProTrade(action)).toBe("needs-action");
    expect(classifyProTrade(waiting)).toBe("waiting");
    expect(classifyProTrade(stale)).toBe("stale");
    expect([stale, waiting, action].sort(compareProTrades).map((item) => item.locator.orderId)).toEqual([1, 2, 3]);
  });

  it("classifies renewable maker offers independently", () => {
    expect(classifyProTrade({ ...snapshot({ status: 5, is_maker: true }), renewable: true })).toBe("renewable");
  });

  it("treats paused maker offers as resumable but not paused taker orders", () => {
    const pausedMaker = snapshot({ status: 2, is_maker: true });
    const pausedTaker = snapshot({ status: 2, is_maker: false });

    expect(isResumableOrRenewableOffer(pausedMaker)).toBe(true);
    expect(classifyProTrade(pausedMaker)).toBe("renewable");
    expect(matchesFilter(pausedMaker, "renewable")).toBe(true);
    expect(summaryCounts([pausedMaker]).renewable).toBe(1);
    expect(isResumableOrRenewableOffer(pausedTaker)).toBe(false);
    expect(classifyProTrade(pausedTaker)).toBe("waiting");
  });

  it("assigns each trade to only one summary category", () => {
    const actionableActive = snapshot({ status: 6, is_buyer: true, is_seller: false });
    const waitingActive = snapshot({ status: 7, is_buyer: true, is_seller: false });
    const publicOffer = snapshot({ status: 1, is_maker: true });
    const resumableOffer = snapshot({ status: 2, is_maker: true });
    const counts = summaryCounts([actionableActive, waitingActive, publicOffer, resumableOffer]);

    expect(counts).toEqual({
      "needs-action": 1,
      active: 1,
      public: 1,
      renewable: 1
    });
    expect(matchesFilter(actionableActive, "needs-action")).toBe(true);
    expect(matchesFilter(actionableActive, "active")).toBe(false);
  });

  it("counts each robot with rewards as one claim action", () => {
    expect(summaryCounts([], 2)).toEqual({
      "needs-action": 2,
      active: 0,
      public: 0,
      renewable: 0
    });
  });

  it("maps every coordinator order status to a stable desk group", () => {
    const groups = new Set(["needs-action", "in-progress", "waiting", "renewable", "stale"]);
    for (let status = 0; status <= 18; status += 1) {
      expect(groups.has(classifyProTrade(snapshot({ status })))).toBe(true);
    }
  });

  it("sorts equal-priority trades by their nearest deadline", () => {
    const later = snapshot({ id: 2, status: 1, is_maker: true, expires_at: "2026-07-21T13:00:00Z" });
    const sooner = snapshot({ id: 1, status: 1, is_maker: true, expires_at: "2026-07-21T12:00:00Z" });

    expect([later, sooner].sort(compareProTrades).map((item) => item.locator.orderId)).toEqual([1, 2]);
  });

  it("escalates deadline emphasis as actionable time runs out", () => {
    const now = Date.UTC(2026, 7, 9, 12);

    expect(proDeadlineTone(undefined, now)).toBe("quiet");
    expect(proDeadlineTone(now - 1, now)).toBe("elapsed");
    expect(proDeadlineTone(now + 30 * 60_000, now)).toBe("urgent");
    expect(proDeadlineTone(now + 31 * 60_000, now)).toBe("soon");
    expect(proDeadlineTone(now + 2 * 60 * 60_000 + 1, now)).toBe("quiet");
  });

  it("offers only fresh robots without active work for new offers", () => {
    const ready = robotSlot("ready-token", "Ready Robot");
    const reserved = { ...robotSlot("reserved-token", "Reserved Robot"), activeOrderId: 8 };
    const stale = robotSlot("stale-token", "Stale Robot");
    const active = robotSlot("active-token", "Active Robot");
    const snapshots = {
      stale: {
        ...snapshot({ id: 3, status: 1, is_maker: true }),
        locator: locator(stale, 3),
        freshness: "stale" as const
      },
      active: { ...snapshot({ id: 4, status: 9 }), locator: locator(active, 4) }
    };
    const slots = [ready, reserved, stale, active];

    expect(
      selectOfferReadyRobots(slots, summarizeProRobots(slots, snapshots), snapshots).map((robot) => robot.nickname)
    ).toEqual(["Ready Robot"]);
  });

  it("keeps a successful status baseline visible during routine refreshes", () => {
    expect(hasProRobotStatusBaseline()).toBe(false);
    const refreshing = {
      slotId: "slot",
      epoch: 0,
      inFlight: true,
      lastAttemptAt: 2,
      lastSuccessAt: 1
    };
    expect(hasProRobotStatusBaseline(refreshing)).toBe(true);
    expect(
      hasProRobotStatusBaseline({
        slotId: "new-slot",
        epoch: 0,
        inFlight: false,
        locallyReadyAt: 3
      })
    ).toBe(true);
  });
});

function robotSlot(token: string, nickname: string): RobotSlot {
  const identity = deriveRobotIdentity(token.padEnd(40, "x"));
  return {
    ...identity,
    nickname,
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

function locator(slot: RobotSlot, orderId: number) {
  return { slotId: slot.tokenSHA256, shortAlias: "lake", orderId };
}

function snapshot(overrides: Partial<OrderDto> = {}): ProTradeSnapshot {
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
    expires_at: "2026-07-21T12:00:00Z",
    shortAlias: "lake",
    ...overrides
  } satisfies OrderDto;
  return {
    key: `slot:lake:${order.id}`,
    locator: { slotId: "slot", shortAlias: "lake", orderId: order.id },
    nickname: "Robot",
    hashId: "hash",
    order,
    renewable: false,
    released: false,
    freshness: "fresh",
    updatedAt: 1,
    changedAt: 1
  };
}
