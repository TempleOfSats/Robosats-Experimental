// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeActionSurface } from "@/domains/orders/OrderPage";
import { getTradeActionCommands } from "@/domains/orders/orderActions";
import { getTradeViewState } from "@/domains/orders/orderStateMachine";
import type { OrderDto } from "@/domains/orders/order.types";

const playHaptic = vi.hoisted(() => vi.fn());
vi.mock("@/lib/haptics", () => ({ playHaptic }));

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  playHaptic.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("TradeActionSurface", () => {
  it("keeps an irreversible preview open on failure and closes it only after a successful retry", async () => {
    const order = sellerReleaseOrder();
    const actions = getTradeActionCommands(order, getTradeViewState(order)).filter(
      (action) => action.key === "confirm-fiat-received"
    );
    const onSubmit = vi
      .fn<(action: (typeof actions)[number]) => Promise<string | undefined>>()
      .mockResolvedValueOnce("The coordinator rejected this release.")
      .mockResolvedValueOnce(undefined);

    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(<TradeActionSurface actions={actions} canSubmit loading={false} onSubmit={onSubmit} />);
    });

    await act(async () => buttonWithText("Confirm 12 USD received").click());
    expect(document.body.textContent).toContain("Check your account balance");
    expect(document.body.textContent).toContain("18,826 sats will be released");
    expect(document.body.textContent).not.toContain("Revolut");
    expect(document.body.textContent).not.toContain("SellerRobot");
    expect(document.body.textContent).not.toContain("#92195");
    expect(document.body.textContent).not.toContain("—");
    expect(document.activeElement?.textContent).toContain("Go back");

    await act(async () => buttonWithText("Release 18,826 sats").click());
    expect(document.body.textContent).toContain("The coordinator rejected this release.");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(playHaptic.mock.calls).toEqual([["commit"]]);

    await act(async () => buttonWithText("Release 18,826 sats").click());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(playHaptic.mock.calls).toEqual([["commit"], ["commit"], ["success"]]);
  });

  it("closes a stale preview and explains that the authoritative action changed", async () => {
    const order = sellerReleaseOrder();
    const actions = getTradeActionCommands(order, getTradeViewState(order)).filter(
      (action) => action.key === "confirm-fiat-received"
    );
    const onSubmit = vi.fn<(action: (typeof actions)[number]) => Promise<string | undefined>>();
    root = createRoot(document.querySelector("#root")!);

    await act(async () => {
      root?.render(<TradeActionSurface actions={actions} canSubmit loading={false} onSubmit={onSubmit} />);
    });
    await act(async () => buttonWithText("Confirm 12 USD received").click());

    await act(async () => {
      root?.render(<TradeActionSurface actions={[]} canSubmit loading={false} onSubmit={onSubmit} />);
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain(
      "The order changed, so confirm 12 usd received is no longer available."
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

function buttonWithText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

function sellerReleaseOrder(): OrderDto {
  return {
    id: 92195,
    status: 10,
    type: 1,
    amount: 12,
    currency: 1,
    payment_method: "Revolut",
    premium: 0,
    satoshis: 18_826,
    is_maker: true,
    is_taker: false,
    is_buyer: false,
    is_seller: true,
    maker_nick: "SellerRobot",
    maker_hash_id: "seller-hash",
    taker_nick: "BuyerRobot",
    taker_hash_id: "buyer-hash",
    bond_invoice: "",
    bond_satoshis: 500,
    escrow_invoice: "",
    escrow_satoshis: 18_826,
    invoice_amount: 18_826,
    swap_allowed: false,
    suggested_mining_fee_rate: 0,
    swap_fee_rate: 0,
    expires_at: "2099-08-08T18:00:00Z",
    shortAlias: "temple"
  };
}
