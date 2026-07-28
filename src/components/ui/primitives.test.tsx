import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PaymentMethodPicker } from "@/domains/orderbook/OfferMeta";

describe("shared UI primitives", () => {
  it("keeps destructive colors owned by the destructive variant", () => {
    const html = renderToStaticMarkup(<Button variant="destructive">Remove</Button>);

    expect(html).toContain("bg-destructive");
    expect(html).not.toContain("text-foreground");
  });

  it("exposes loading state without replacing the visible action label", () => {
    const html = renderToStaticMarkup(
      <Button loading loadingLabel="Removing robot">Remove</Button>
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
    expect(html).toContain("Remove");
    expect(html).toContain("Removing robot");
    expect(html).toContain('role="status"');
  });

  it("separates visual card presentation from document hierarchy", () => {
    const html = renderToStaticMarkup(
      <Card as="article">
        <CardTitle as="h4">Trade details</CardTitle>
      </Card>
    );

    expect(html).toContain("<article");
    expect(html).toContain("<h4");
  });

  it("connects field labels, hints, and errors to their control", () => {
    const html = renderToStaticMarkup(
      <Field error="Enter a valid invoice" hint="Starts with lnbc" label="Lightning invoice" required>
        <textarea />
      </Field>
    );

    expect(html).toContain("<label");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/aria-describedby="[^"]+-hint [^"]+-error"/);
  });

  it("renders payment methods as a named combobox with one selected option", () => {
    const html = renderToStaticMarkup(
      <PaymentMethodPicker
        label="Payment method"
        open
        options={[
          { name: "Revolut", icon: "revolut.svg" },
          { name: "Wise", icon: "wise.svg" }
        ]}
        value="Revolut"
        onChange={() => undefined}
      />
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="Payment method"');
    expect(html).toContain('role="listbox"');
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  });

  it("can require a concrete payment method without offering ANY", () => {
    const html = renderToStaticMarkup(
      <PaymentMethodPicker
        allowAny={false}
        label="Select payment method"
        open
        options={[
          { name: "Revolut", icon: "revolut.svg" },
          { name: "Wise", icon: "wise.svg" }
        ]}
        value=""
        onChange={() => undefined}
      />
    );

    expect(html).toContain('placeholder="Select a method"');
    expect(html).not.toContain(">ANY<");
    expect(html).toContain(">Revolut<");
    expect(html).toContain(">Wise<");
  });
});
