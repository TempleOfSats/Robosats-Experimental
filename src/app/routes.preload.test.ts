// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { unavailable } = vi.hoisted(() => ({
  unavailable: () => {
    throw new Error("Route chunk unavailable");
  }
}));

vi.mock("@/domains/garage/RobotGaragePage", unavailable);
vi.mock("@/domains/orderbook/OffersPage", unavailable);
vi.mock("@/domains/maker/CreateOrderPage", unavailable);
vi.mock("@/domains/coordinators/CoordinatorsPage", unavailable);
vi.mock("@/domains/orders/OrderPage", unavailable);
vi.mock("@/domains/settings/SettingsPage", unavailable);
vi.mock("@/domains/statistics/StatisticsPage", unavailable);
vi.mock("@/domains/pro/ProWorkspacePage", unavailable);

import {
  preloadAllAppRoutes,
  preloadAppRoute,
  preloadPrimaryTradeRoutes,
  preloadQuickAccessRoutes
} from "@/app/routes";
import { preloadOrderRoute } from "@/domains/orders/orderRoute";
import { preloadStatisticsRoute } from "@/domains/statistics/statisticsRoute";

let unhandled: unknown[] = [];
const collectUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled = [];
  process.on("unhandledRejection", collectUnhandled);
});

afterEach(() => {
  process.off("unhandledRejection", collectUnhandled);
  vi.restoreAllMocks();
});

describe("optional route preload failures", () => {
  it("settles quick-access and trade warm-up without reloading the document", async () => {
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);

    await expect(preloadQuickAccessRoutes()).resolves.toBeUndefined();
    await expect(preloadPrimaryTradeRoutes()).resolves.toBeUndefined();
    await settleTurns();

    expect(reload).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it("settles every background warm-up chunk without reloading the document", async () => {
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);

    await expect(preloadAllAppRoutes()).resolves.toBeUndefined();
    await settleTurns();

    expect(reload).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it("settles domain hover preloads for unavailable routes", async () => {
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);

    preloadOrderRoute();
    preloadStatisticsRoute();
    await settleTurns();

    expect(reload).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it("settles a hover preload for one unavailable route", async () => {
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);

    preloadAppRoute("/offers");
    preloadAppRoute("/offers");
    await settleTurns();

    expect(reload).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });
});

async function settleTurns(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}
