// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrderPage } from "@/domains/orders/OrderPage";

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("setup cancellation actions", () => {
  it.each(["abc", "0", "1.5", "9007199254740992"])(
    "terminates an invalid %s order route without showing the loading skeleton",
    async (orderId) => {
      root = createRoot(document.querySelector("#root")!);
      await act(async () => {
        root?.render(
          <MemoryRouter initialEntries={[`/order/lake/${orderId}`]}>
            <Routes>
              <Route path="/order/:shortAlias/:orderId" element={<OrderPage />} />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(document.body.textContent).toContain("Invalid trade link");
      expect(document.body.textContent).toContain("Browse offers");
      expect(document.querySelector('[aria-label="Loading trade"]')).toBeNull();
    }
  );

  it.each(["setup-buyer", "setup-seller"])("renders Cancel order in the %s flow", async (scenario) => {
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={[`/order/lake/95955?tradePreview=${scenario}`]}>
          <OrderPage embeddedLocator={{ shortAlias: "lake", orderId: 95_955 }} />
        </MemoryRouter>
      );
    });

    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Cancel order"
    );

    expect(cancel).toBeDefined();
    expect(cancel?.disabled).toBe(false);
  });
});
