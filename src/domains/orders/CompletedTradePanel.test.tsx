import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompletedTradePanel } from "@/domains/orders/CompletedTradePanel";
import type { OrderDto } from "@/domains/orders/order.types";

describe("CompletedTradePanel", () => {
  it("shows the maker seller's final amounts", () => {
    const html = render(
      completedOrder({
        is_maker: true,
        is_taker: false,
        is_buyer: false,
        is_seller: true,
        maker_summary: {
          is_buyer: false,
          received_fiat: 12,
          sent_sats: 18_991,
          trade_fee_sats: 33,
          trade_fee_percent: 0.175
        }
      })
    );

    expect(html).toContain("Trade finished!");
    expect(html).toContain("Fiat received");
    expect(html).toContain("12 USD");
    expect(html).toContain("Bitcoin sent");
    expect(html).toContain("18,991 sats");
    expect(html).toContain("33 sats");
  });

  it("shows the taker buyer's final amounts", () => {
    const html = render(
      completedOrder({
        is_maker: false,
        is_taker: true,
        is_buyer: true,
        is_seller: false,
        taker_summary: {
          is_buyer: true,
          sent_fiat: 12,
          received_sats: 18_915,
          trade_fee_sats: 5,
          trade_fee_percent: 0.025
        }
      })
    );

    expect(html).toContain("Fiat sent");
    expect(html).toContain("Bitcoin received");
    expect(html).toContain("18,915 sats");
    expect(html).toContain("5 sats");
  });

  it("keeps a queued payout in its waiting presentation", () => {
    const html = render(completedOrder({ tx_queued: true, txid: undefined }));

    expect(html).toContain("Payout accepted");
    expect(html).toContain("will keep checking until the transaction is broadcast");
    expect(html).not.toContain("Rate your trade");
    expect(html).not.toContain("Trade summary");
  });
});

function render(order: OrderDto): string {
  return renderToStaticMarkup(
    <CompletedTradePanel
      canSubmit
      coordinatorName="Temple of Sats"
      loading={false}
      onPublishRating={vi.fn()}
      onStartAgain={vi.fn()}
      order={order}
    />
  );
}

function completedOrder(overrides: Partial<OrderDto>): OrderDto {
  return {
    id: 92045,
    status: 14,
    type: 1,
    amount: 12,
    currency: 1,
    payment_method: "Revolut",
    premium: 0,
    satoshis: 18_991,
    is_maker: true,
    is_taker: false,
    is_buyer: false,
    is_seller: true,
    maker_nick: "Maker",
    maker_hash_id: "maker-hash",
    taker_nick: "Taker",
    taker_hash_id: "taker-hash",
    bond_invoice: "",
    bond_satoshis: 0,
    escrow_invoice: "",
    escrow_satoshis: 0,
    invoice_amount: 18_991,
    swap_allowed: false,
    suggested_mining_fee_rate: 0,
    swap_fee_rate: 0,
    expires_at: "2026-08-03T20:00:00Z",
    shortAlias: "temple",
    ...overrides
  };
}
