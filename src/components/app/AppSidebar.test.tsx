// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "@/components/app/AppSidebar";
import { useGarageStore } from "@/domains/garage/garageStore";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  useGarageStore.setState({ currentToken: undefined, hydrate: vi.fn(), slots: [] });
  useProPreferencesStore.setState({ enabled: true });
  useProTradeIndexStore.getState().resetRuntimeCache();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  useProTradeIndexStore.getState().resetRuntimeCache();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("AppSidebar Pro attention", () => {
  it("seeds hydrated attention quietly and pulses only for a later increase", async () => {
    await renderSidebar("/offers");

    await act(async () => {
      useProTradeIndexStore.getState().hydrateRuntimeCache(
        {
          [snapshot(1).key]: snapshot(1)
        },
        {}
      );
    });
    expect(proDeskLink().classList.contains("nav-item-attention-pulse")).toBe(false);

    await act(async () => useProTradeIndexStore.getState().upsertSnapshot(snapshot(2)));
    expect(proDeskLink().classList.contains("nav-item-attention-pulse")).toBe(true);

    await act(async () => vi.advanceTimersByTime(1_100));
    expect(proDeskLink().classList.contains("nav-item-attention-pulse")).toBe(false);
  });

  it("does not pulse while the Pro Desk destination is already open", async () => {
    await renderSidebar("/pro");
    await act(async () => useProTradeIndexStore.getState().hydrateRuntimeCache({}, {}));
    await act(async () => useProTradeIndexStore.getState().upsertSnapshot(snapshot(1)));

    expect(proDeskLink().classList.contains("nav-item-attention-pulse")).toBe(false);
  });
});

async function renderSidebar(path: string) {
  root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <AppSidebar platform={{} as never} />
      </MemoryRouter>
    );
  });
}

function proDeskLink(): HTMLAnchorElement {
  const link = document.querySelector<HTMLAnchorElement>('a[href="/pro"]');
  if (!link) throw new Error("Missing Pro Desk link");
  return link;
}

function snapshot(orderId: number): ProTradeSnapshot {
  return {
    key: `slot:temple:${orderId}`,
    locator: { slotId: "slot", shortAlias: "temple", orderId },
    nickname: `Robot ${orderId}`,
    hashId: `hash-${orderId}`,
    order: {
      id: orderId,
      status: 6,
      is_buyer: true,
      is_seller: false
    } as never,
    renewable: false,
    released: false,
    freshness: "fresh"
  };
}
