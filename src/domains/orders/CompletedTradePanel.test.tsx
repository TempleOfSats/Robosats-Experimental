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

    expect(html).toContain("Trade completed");
    expect(html).toContain("You sold bitcoin");
    expect(html).toContain("12 USD");
    expect(html).toContain("18,991 sats");
    expect(html).toContain("33 sats");
    expect(receiptSummary(html)).not.toContain("Fiat received</dt>");
    expect(receiptSummary(html)).not.toContain("Bitcoin sent</dt>");
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

    expect(html).toContain("You bought bitcoin");
    expect(html).toContain("for 12 USD");
    expect(html).toContain("18,915 sats");
    expect(html).toContain("5 sats");
    expect(receiptSummary(html)).not.toContain("Fiat sent</dt>");
    expect(receiptSummary(html)).not.toContain("Bitcoin received</dt>");
  });

  it("keeps optional ratings collapsed until the trader opens them", () => {
    const html = render(completedOrder({}));

    expect(html).toContain('<details class="trade-completion-rating">');
    expect(html).toContain("Optional feedback for your peer and host");
    expect(html).not.toContain('<details class="trade-completion-rating" open="">');
  });

  it("keeps the seller receipt final while the buyer payout is queued", () => {
    const html = render(completedOrder({ tx_queued: true, txid: undefined }));

    expect(html).toContain("Trade completed");
    expect(html).toContain("Start another trade");
  });

  it("renders dispute resolution without inventing an award amount", () => {
    const html = render(completedOrder({ status: 18, is_maker: true, is_taker: false }));

    expect(html).toContain("Dispute resolved in your favor");
    expect(html).toContain("Your robot won");
    expect(html).toContain("Contract bitcoin");
    expect(html).not.toContain("awarded");
  });

  it("explains the bond outcome on a unilateral cancellation", () => {
    const html = render(
      completedOrder({
        status: 4,
        is_maker: true,
        is_taker: false,
        is_buyer: false,
        is_seller: true,
        taker_locked: false
      })
    );

    expect(html).toContain("This order was cancelled");
    expect(html).toContain("Your bond was returned without penalty.");
  });

  it("explains that collaborative cancellation returns both bonds", () => {
    const html = render(completedOrder({ status: 12 }));

    expect(html).toContain("Both peers&#x27; bonds were returned without penalty.");
  });

  it("renders unavailable instead of zero when bitcoin cannot be proven", () => {
    const html = render(
      completedOrder({
        satoshis: 0,
        escrow_satoshis: 0,
        invoice_amount: 0,
        trade_satoshis: 0,
        num_satoshis: 0,
        sent_satoshis: 0
      })
    );

    expect(html).toContain("Unavailable");
    expect(html).not.toContain("0 sats");
  });
});

it("shows swap and mining fees for a swap trade buyer", () => {
  const html = render(
    completedOrder({
      is_maker: false,
      is_taker: true,
      is_buyer: true,
      is_seller: false,
      taker_summary: {
        is_buyer: true,
        is_swap: true,
        sent_fiat: 100,
        received_sats: 50_000,
        trade_fee_sats: 25,
        trade_fee_percent: 0.05,
        swap_fee_sats: 500,
        swap_fee_percent: 0.5,
        mining_fee_sats: 300
      }
    })
  );

  expect(html).toContain("Onchain swap fee");
  expect(html).toContain("500 sats");
  expect(html).toContain("0.5%");
  expect(html).not.toContain("50%");
  expect(html).toContain("Mining fee");
  expect(html).toContain("300 sats");
});

it("uses bitcoin-swap language and satoshi units for BTC-denominated contracts", () => {
  const html = render(
    completedOrder({
      amount: 0.001,
      currency: 1000,
      is_maker: false,
      is_taker: true,
      is_buyer: true,
      is_seller: false,
      taker_summary: {
        is_buyer: true,
        sent_fiat: 0.001,
        received_sats: 98_500,
        trade_fee_sats: 100
      }
    })
  );

  expect(html).toContain("Bitcoin swap completed");
  expect(html).toContain("Bitcoin received");
  expect(html).toContain("after sending 100,000 sats");
  expect(html).toContain("100,000 sats");
  expect(html).toContain("98,500 sats");
  expect(html).not.toContain("Contract fiat");
  expect(html).not.toContain("You bought bitcoin");
});

it("does not show swap rows for a non-swap trade", () => {
  const html = render(
    completedOrder({
      is_maker: true,
      is_buyer: false,
      is_seller: true,
      maker_summary: {
        is_buyer: false,
        sent_sats: 18_991,
        received_fiat: 12,
        trade_fee_sats: 33,
        trade_fee_percent: 0.175
      }
    })
  );

  expect(html).not.toContain("Onchain swap fee");
  expect(html).not.toContain("Mining fee");
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
      robotHashId="robot-hash"
      robotName="CurrentRobot"
    />
  );
}

function receiptSummary(html: string): string {
  return html.split('<details class="trade-receipt-breakdown">')[0];
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
