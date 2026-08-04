import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TradeProgress } from "@/domains/orders/TradeProgress";
import type { OrderDto } from "@/domains/orders/order.types";

describe("TradeProgress", () => {
  it("marks status 13 complete for the seller", () => {
    expect(stepStates(progressOrder(13, { is_maker: true, is_seller: true }))).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
      "complete"
    ]);
  });

  it.each([
    [13, "active"],
    [14, "complete"],
    [15, "waiting"]
  ])("shows buyer status %i at the finish step as %s", (status, finishState) => {
    expect(stepStates(progressOrder(status, { is_taker: true, is_buyer: true }))).toEqual([
      "complete",
      "complete",
      "complete",
      finishState
    ]);
  });

  it("shows dispute wins as complete and losses as danger", () => {
    expect(stepStates(progressOrder(17, { is_taker: true }))).toEqual(["complete", "complete", "complete", "complete"]);
    expect(stepStates(progressOrder(17, { is_maker: true }))).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
      "danger"
    ]);
  });

  it("renders five maker steps and four taker steps", () => {
    expect(stepStates(progressOrder(9, { is_maker: true }))).toHaveLength(5);
    expect(stepStates(progressOrder(9, { is_taker: true }))).toHaveLength(4);
  });
});

function progressOrder(status: number, overrides: Partial<OrderDto>): OrderDto {
  return {
    status,
    is_maker: false,
    is_taker: false,
    is_buyer: false,
    is_seller: false,
    ...overrides
  } as OrderDto;
}

function stepStates(order: OrderDto): string[] {
  const html = renderToStaticMarkup(<TradeProgress order={order} />);
  return [...html.matchAll(/trade-progress-step ([^"]+)/g)].map((match) => match[1]);
}
