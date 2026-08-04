// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderDetailsPanel } from "@/domains/orders/OrderDetailsPanel";
import type { OrderDto } from "@/domains/orders/order.types";

describe("OrderDetailsPanel", () => {
  it("keeps approximate bitcoin amounts aligned with the buyer and seller roles", () => {
    const buyer = renderDetails(baseOrder);
    const seller = renderDetails({
      ...baseOrder,
      is_buyer: false,
      is_seller: true,
      is_maker: true,
      is_taker: false
    });

    expect(buyer).toContain("You send via Revolut 12 USD");
    expect(buyer).toContain("You receive Approx. 18,915 sats");
    expect(seller).toContain("You send via Lightning Approx. 18,915 sats");
    expect(seller).toContain("You receive via Revolut 12 USD");
  });
});

function renderDetails(order: OrderDto): string {
  return renderToStaticMarkup(
    <OrderDetailsPanel
      coordinatorAlias="temple"
      defaultOpen
      order={order}
      robotHashId="robot-hash"
      robotName="Patient robot"
    />
  );
}

const baseOrder = {
  id: 92045,
  status: 9,
  currency: 1,
  amount: 12,
  payment_method: "Revolut",
  premium: 0,
  trade_satoshis: 18_915,
  invoice_amount: 18_915,
  is_buyer: true,
  is_seller: false,
  is_maker: false,
  is_taker: true,
  expires_at: "2030-01-01T00:00:00Z",
  shortAlias: "temple"
} as OrderDto;
