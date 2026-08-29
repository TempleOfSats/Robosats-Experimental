// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGuidedOrderbook } from "@/domains/pro/guidedOrderbook";

const orderbook = vi.hoisted(() => {
  const unsubscribe = vi.fn();
  const refreshOrderbook = vi.fn();
  const state = { orders: [], loading: false, refreshing: false, refreshOrderbook };
  return {
    refreshOrderbook,
    state,
    subscribe: vi.fn(() => unsubscribe),
    unsubscribe
  };
});

vi.mock("@/domains/orderbook/orderbookStore", () => ({
  useOrderbookStore: {
    getState: () => orderbook.state,
    subscribe: orderbook.subscribe
  }
}));

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  orderbook.refreshOrderbook.mockReset();
  orderbook.subscribe.mockClear();
  orderbook.unsubscribe.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("guided orderbook lifecycle", () => {
  it("shows a recoverable error, retries, and unsubscribes when closed", async () => {
    orderbook.refreshOrderbook.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);

    await render(true);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Offers could not be loaded"));

    const retry = document.querySelector<HTMLButtonElement>("button");
    await act(async () => retry?.click());
    await vi.waitFor(() => expect(orderbook.refreshOrderbook).toHaveBeenCalledTimes(2));
    expect(document.body.textContent).not.toContain("Offers could not be loaded");

    await render(false);
    expect(orderbook.unsubscribe).toHaveBeenCalledTimes(2);
  });
});

async function render(open: boolean) {
  await act(async () => root?.render(<Harness open={open} />));
}

function Harness({ open }: { open: boolean }) {
  const snapshot = useGuidedOrderbook(open);
  return (
    <div>
      {snapshot.error ? <p>{snapshot.error}</p> : null}
      <button onClick={snapshot.retry} type="button">
        Retry
      </button>
    </div>
  );
}
