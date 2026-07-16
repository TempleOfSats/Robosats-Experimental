import { describe, expect, it } from "vitest";
import { TRADE_PREVIEW_CASES, tradePreviewOrder } from "@/domains/orders/tradePreviewFixtures";

describe("trade preview fixtures", () => {
  it("has a renderable order for every catalog entry", () => {
    const ids = TRADE_PREVIEW_CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const item of TRADE_PREVIEW_CASES) {
      const order = tradePreviewOrder(item.id);
      expect(order, item.id).toBeDefined();
      expect(order?.id, item.id).toBeGreaterThan(0);
      expect(new Date(order?.expires_at ?? 0).getTime(), item.id).toBeGreaterThan(Date.now());
    }
  });

  it("does not create an order for an unknown preview", () => {
    expect(tradePreviewOrder("not-a-scenario")).toBeUndefined();
  });
});
