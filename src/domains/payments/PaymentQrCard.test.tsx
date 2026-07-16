import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentQrCard } from "@/domains/payments/PaymentQrCard";

describe("PaymentQrCard", () => {
  it("renders a real QR svg without exposing a raw-invoice details panel", () => {
    const html = renderToStaticMarkup(
      <PaymentQrCard
        concept="taker_bond"
        title="Taker bond"
        value="lnbc1testinvoice"
        amountSats={12578}
      />
    );

    expect(html).toContain("<svg");
    expect(html).toContain("/static/assets/vector/R-notext.svg");
    expect(html).toContain("Amount to lock");
    expect(html).not.toContain("invoice-details");
    expect(html).not.toContain("Payment hash");
  });

  it("shows a countdown without a secondary expiry details row", () => {
    const expiresAt = new Date(Date.now() + 90_000).toISOString();
    const html = renderToStaticMarkup(
      <PaymentQrCard
        concept="escrow"
        title="Escrow"
        value="lnbc1escrow"
        expiresAt={expiresAt}
        footer={<button type="button">Cancel order</button>}
      />
    );

    expect(html).toContain("Expires in");
    expect(html).toContain("payment-countdown");
    expect(html).not.toContain("Expires at");
    expect(html).toContain("Cancel order");
  });
});
