import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { useGarageStore, type RobotSlot } from "@/domains/garage/garageStore";
import {
  getRobotOrderAvailability,
  reserveRobotOrderAction,
  revalidateRobotForNewOrder,
  resetRobotOrderReservationsForTests
} from "@/domains/orders/robotOrderGuard";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";

const initialGarageState = useGarageStore.getState();
const initialTradeIndexState = useProTradeIndexStore.getState();

afterEach(() => {
  resetRobotOrderReservationsForTests();
  useGarageStore.setState(initialGarageState, true);
  useProTradeIndexStore.setState(initialTradeIndexState, true);
});

describe("robot order guard", () => {
  it("allows an idle robot", () => {
    expect(getRobotOrderAvailability(robotSlot()).available).toBe(true);
  });

  it("does not block actions while an idle robot is being refreshed", () => {
    const slot = {
      ...robotSlot({ loading: true }),
      loading: true
    };

    expect(getRobotOrderAvailability(slot).available).toBe(true);
  });

  it("blocks active slot, coordinator, and indexed reservations", () => {
    expect(getRobotOrderAvailability({ ...robotSlot(), activeOrderId: 10 }).available).toBe(false);
    expect(getRobotOrderAvailability(robotSlot({ activeOrderId: 11 })).available).toBe(false);
    expect(getRobotOrderAvailability(robotSlot(), { order: snapshot() }).available).toBe(false);
  });

  it("allows expired renewable orders but keeps paused orders reserved", () => {
    const renewableSlot = {
      ...robotSlot({ activeOrderId: 12, renewableOrderId: 12 }),
      activeOrderId: 12
    };
    const renewable = snapshot({
      id: 12,
      status: 5,
      is_maker: true,
      is_taker: false
    });
    const paused = snapshot({
      id: 13,
      status: 2,
      is_maker: true,
      is_taker: false
    });

    expect(getRobotOrderAvailability(renewableSlot, { renewable }).available).toBe(true);
    expect(getRobotOrderAvailability(renewableSlot).available).toBe(true);
    expect(getRobotOrderAvailability(robotSlot(), { paused }).available).toBe(false);
  });

  it("keeps a robot reserved when active work exists beside an older renewable order", () => {
    const slot = robotSlot({ activeOrderId: 12, renewableOrderId: 12 });
    const busySlot = {
      ...slot,
      activeOrderId: 13,
      robots: {
        ...slot.robots,
        lake: {
          ...slot.robots.local,
          shortAlias: "lake",
          activeOrderId: 13,
          lastOrderId: 13,
          renewableOrderId: undefined
        }
      }
    };

    expect(getRobotOrderAvailability(busySlot, {
      renewable: snapshot({
        id: 12,
        status: 5,
        is_maker: true,
        is_taker: false
      }),
      active: snapshot({ id: 13, status: 1, is_maker: true })
    }).available).toBe(false);
  });

  it("blocks a second local order action until the first releases", () => {
    const slot = robotSlot();
    const release = reserveRobotOrderAction(slot.tokenSHA256);
    expect(release).toBeTypeOf("function");
    expect(reserveRobotOrderAction(slot.tokenSHA256)).toBeUndefined();
    expect(getRobotOrderAvailability(slot).reason).toBe("pending");
    release?.();
    expect(getRobotOrderAvailability(slot).available).toBe(true);
  });

  it("blocks an order when the coordinator refresh discovers active work", async () => {
    const slot = robotSlot();
    const busySlot = {
      ...slot,
      activeOrderId: 42,
      robots: { ...slot.robots, lake: { ...slot.robots.local, shortAlias: "lake", activeOrderId: 42 } }
    };
    const refreshRobotSlot = vi.fn(async () => {
      useGarageStore.setState({ slots: [busySlot] });
      return { slotId: slot.tokenSHA256, coordinators: [{ shortAlias: "lake", activeOrderId: 42 }] };
    });
    useGarageStore.setState({ ...initialGarageState, slots: [slot], hydrated: true, refreshRobotSlot }, true);
    useProTradeIndexStore.setState({ ...initialTradeIndexState, snapshots: {} }, true);

    await expect(revalidateRobotForNewOrder({
      coordinator: coordinator(),
      proEnabled: false,
      slotId: slot.tokenSHA256
    })).rejects.toThrow("already has an order");
    expect(refreshRobotSlot).toHaveBeenCalledWith(slot.token, [coordinator()], {
      preferredAliases: ["lake"],
      priority: "foreground",
      source: "robot-refresh"
    });
  });
});

function robotSlot(robot: {
  activeOrderId?: number;
  renewableOrderId?: number;
  loading?: boolean;
} = {}): RobotSlot {
  const identity = deriveRobotIdentity("robot-order-guard-token".padEnd(40, "x"));
  return {
    ...identity,
    nickname: "GuardedRobot",
    earnedRewards: 0,
    robots: { local: { token: identity.token, shortAlias: "local", tokenSHA256: identity.tokenSHA256, ...robot } }
  };
}

function snapshot(overrides: Partial<NonNullable<ProTradeSnapshot["order"]>> = {}): ProTradeSnapshot {
  const order = {
    id: 1,
    status: 1,
    type: 0,
    amount: 100,
    currency: 1,
    payment_method: "SEPA",
    premium: 0,
    satoshis: 1000,
    is_maker: true,
    is_taker: false,
    is_buyer: true,
    is_seller: false,
    maker_nick: "Maker",
    maker_hash_id: "maker",
    taker_nick: "",
    taker_hash_id: "",
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
  };
  return {
    key: `${robotSlot().tokenSHA256}:lake:${order.id}`,
    locator: { slotId: robotSlot().tokenSHA256, shortAlias: "lake", orderId: order.id },
    nickname: "GuardedRobot",
    hashId: "hash",
    order,
    renewable: false,
    released: false,
    freshness: "fresh"
  };
}

function coordinator(): CoordinatorSummary {
  return {
    shortAlias: "lake",
    longAlias: "TheBigLake",
    color: "#1976d2",
    url: "https://lake.example",
    avatarUrl: "/lake.webp",
    smallAvatarUrl: "/lake-small.webp",
    badgeIcons: [],
    enabled: true,
    online: true
  };
}
