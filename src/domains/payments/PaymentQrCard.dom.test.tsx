// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentCardFooter, PaymentQrCard } from "@/domains/payments/PaymentQrCard";

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("PaymentQrCard copy feedback", () => {
  it("confirms a successful copy without changing the payment value", async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    await renderCard(onCopy);

    await act(async () => document.querySelector<HTMLButtonElement>(".payment-actions button")?.click());

    expect(onCopy).toHaveBeenCalledWith("lnbc1testinvoice");
    expect(document.querySelector(".payment-actions")?.textContent).toContain("Copied");
    expect(document.querySelector(".payment-action-status-success")?.textContent).toContain("Invoice copied");
  });

  it("surfaces a copy failure and lets the user try again", async () => {
    const onCopy = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined);
    await renderCard(onCopy);

    await act(async () => document.querySelector<HTMLButtonElement>(".payment-actions button")?.click());
    expect(document.querySelector(".payment-action-status-error")?.textContent).toContain("Could not copy");

    await act(async () => document.querySelector<HTMLButtonElement>(".payment-actions button")?.click());
    expect(onCopy).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".payment-action-status-success")?.textContent).toContain("Invoice copied");
  });
});

describe("PaymentCardFooter", () => {
  it("natively disables every descendant action while its parent operation is busy", async () => {
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <PaymentCardFooter disabled>
          <button>Cancel order</button>
        </PaymentCardFooter>
      );
    });

    const footer = document.querySelector<HTMLFieldSetElement>(".payment-card-footer");
    const cancel = footer?.querySelector<HTMLButtonElement>("button");
    expect(footer?.disabled).toBe(true);
    expect(footer?.getAttribute("aria-busy")).toBe("true");
    expect(cancel?.closest("fieldset[disabled]")).toBe(footer);
  });
});

async function renderCard(onCopy: (value: string) => Promise<void>) {
  root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root?.render(
      <PaymentQrCard
        amountSats={12_578}
        concept="taker_bond"
        onCopy={onCopy}
        title="Taker bond"
        value="lnbc1testinvoice"
      />
    );
  });
}
