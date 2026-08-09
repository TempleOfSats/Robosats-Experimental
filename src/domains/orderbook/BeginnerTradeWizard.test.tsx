import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeginnerTradeWizard } from "@/domains/orderbook/BeginnerTradeWizard";
import type { GuidedTradeCriteria } from "@/domains/orderbook/guidedTrade";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

const criteria: GuidedTradeCriteria = {
  intent: "buy",
  currency: "EUR",
  amount: 50,
  paymentMethod: "Zelle"
};

describe("BeginnerTradeWizard", () => {
  it("restores a guided result without rendering a redundant no-match card", () => {
    const html = renderToStaticMarkup(
      <BeginnerTradeWizard
        coordinators={[]}
        initialCriteria={criteria}
        loading={false}
        onClose={() => undefined}
        onCreateOffer={() => undefined}
        onSelectOffer={() => undefined}
        orders={[]}
      />
    );

    expect(html).toContain("No exact match right now");
    expect(html).toContain("Didn&#x27;t find what you were looking for?");
    expect(html).toContain("Set your own terms!");
    expect(html).not.toContain("guided-no-match");
  });

  it("keeps the wizard mounted but non-interactive behind offer review", () => {
    const html = renderToStaticMarkup(
      <BeginnerTradeWizard
        coordinators={[]}
        initialCriteria={criteria}
        loading={false}
        onClose={() => undefined}
        onCreateOffer={() => undefined}
        onSelectOffer={() => undefined}
        orders={[]}
        reviewOpen
      />
    );

    expect(html).toContain("guided-trade-overlay-backgrounded");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("inert");
  });

  it("carries the selected trade direction into matching offer presentation", () => {
    const html = renderToStaticMarkup(
      <BeginnerTradeWizard
        coordinators={[]}
        initialCriteria={criteria}
        loading={false}
        onClose={() => undefined}
        onCreateOffer={() => undefined}
        onSelectOffer={() => undefined}
        orders={[matchingOrder]}
      />
    );

    expect(html).toContain("guided-match guided-match-buy guided-match-featured");
    expect(html).toContain("Best match");
    expect(html).toContain("Review");
  });
});

const matchingOrder: PublicOrder = {
  id: 42,
  type: 1,
  currency: 2,
  currencyCode: "EUR",
  amount: 50,
  has_range: false,
  is_swap: false,
  min_amount: 0,
  max_amount: 0,
  payment_method: "Zelle",
  premium: -1,
  satoshis: 0,
  maker_nick: "CalmRobot42",
  maker_hash_id: "maker-hash",
  bond_size_sats: 1_000,
  coordinatorShortAlias: "lake"
};
