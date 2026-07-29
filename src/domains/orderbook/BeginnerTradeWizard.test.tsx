import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeginnerTradeWizard } from "@/domains/orderbook/BeginnerTradeWizard";
import type { GuidedTradeCriteria } from "@/domains/orderbook/guidedTrade";

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
});
