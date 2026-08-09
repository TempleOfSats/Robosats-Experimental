// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import { OffersPage } from "@/domains/orderbook/OffersPage";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { useOrderbookStore } from "@/domains/orderbook/orderbookStore";
import { defaultProPreferences, useProPreferencesStore } from "@/domains/pro/proPreferencesStore";

const nostrOrderbook = vi.hoisted(() => ({
  resetSession: vi.fn(),
  subscribe: vi.fn(() => () => undefined)
}));

vi.mock("@/domains/orderbook/nostrOrderbook", () => ({
  resetNostrOrderbookSession: nostrOrderbook.resetSession,
  subscribeNostrOrderbook: nostrOrderbook.subscribe
}));

let container: HTMLDivElement;
let root: Root;
let previousActEnvironment: boolean | undefined;
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

beforeEach(() => {
  previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  useFederationStore.setState({
    connection: "api",
    coordinators: [coordinator],
    network: "mainnet",
    origin: "clearnet",
    refreshCoordinators: vi.fn(async () => undefined),
    refreshCoordinatorLimits: vi.fn(async () => true)
  });
  useOrderbookStore.setState({
    orders,
    loading: false,
    refreshing: false,
    cacheState: "none",
    error: undefined,
    lastUpdated: undefined,
    refreshOrderbook: vi.fn(async () => undefined)
  });
  useGarageStore.setState({
    slots: [],
    currentToken: undefined,
    hydrated: true,
    hydrate: vi.fn()
  });
  useProPreferencesStore.setState(defaultProPreferences);
  nostrOrderbook.resetSession.mockClear();
  nostrOrderbook.subscribe.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("OffersPage filters", () => {
  it("resets payment method when currency changes, but not currency when payment method changes", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <OffersPage />
        </MemoryRouter>
      );
    });

    const methodInput = input("Filter by payment method");
    await chooseMethod(methodInput, "Wise");
    expect(methodInput.value).toBe("Wise");

    await chooseCurrency("USD");
    await vi.waitFor(() => expect(methodInput.value).toBe(""));
    expect(currencyValue()).toBe("USD");

    await chooseMethod(methodInput, "Wise");
    expect(methodInput.value).toBe("Wise");
    expect(currencyValue()).toBe("USD");

    await chooseCurrency("USD");
    expect(methodInput.value).toBe("Wise");
  });

  it("uses dedicated icons for each ANY filter while preserving the labels", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <OffersPage />
        </MemoryRouter>
      );
    });

    const intentIcon = container.querySelector<HTMLImageElement>(
      'summary[aria-label="Filter public offers by trade direction"] img'
    );
    const currencyIcon = container.querySelector<HTMLElement>(
      'summary[aria-label="Filter by currency"] .filter-any-icon-currency'
    );
    expect(intentIcon?.getAttribute("src")).toBe("/static/assets/vector/filter-any-buy-sell.svg");
    expect(intentIcon?.closest(".intent-icon")).toBeNull();
    expect(currencyIcon?.classList.contains("filter-any-icon-monochrome")).toBe(true);
    expect(currencyIcon?.tagName).toBe("SPAN");
    expect(currencyIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(currencyIcon?.style.getPropertyValue("--filter-any-icon-mask")).toBe(
      "url(/static/assets/vector/filter-any-currency.svg)"
    );
    expect(currencyIcon?.closest(".currency-flag")).toBeNull();
    const methodIcon = container
      .querySelector('input[aria-label="Filter by payment method"]')
      ?.closest(".image-select")
      ?.querySelector<HTMLElement>(".filter-any-icon-payment-method");
    expect(methodIcon?.classList.contains("filter-any-icon-monochrome")).toBe(true);
    expect(methodIcon?.tagName).toBe("SPAN");
    expect(methodIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(methodIcon?.style.getPropertyValue("--filter-any-icon-mask")).toBe(
      "url(/static/assets/vector/filter-any-payment-method.svg)"
    );
    expect(
      container.querySelector('summary[aria-label="Filter public offers by trade direction"] .image-select-value')
        ?.textContent
    ).toBe("ANY");
    expect(currencyValue()).toBe("ANY");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Filter by payment method"]')?.value).toBe("");
  });

  it("keeps API offers fiat-first when the coordinator also provides satoshis", async () => {
    useOrderbookStore.setState({
      orders: [order({ currency: 2, currencyCode: "EUR", amount: 119, satoshis: 205_420 })]
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <OffersPage />
        </MemoryRouter>
      );
    });

    const amount = container.querySelector(".offer-row .offer-amount-line");
    expect(amount?.textContent).toContain("119");
    expect(amount?.textContent).toContain("EUR");
    expect(amount?.textContent).not.toContain("205,420 sats");
    expect(amount?.querySelector(".amount-mono")).toBeNull();
  });

  it("shows current book context and makes every direction-aware row clearly reviewable", async () => {
    useOrderbookStore.setState({
      lastUpdated: Date.now() - 2 * 60_000,
      orders: [
        order({ id: 1, type: 1, currency: 2, currencyCode: "EUR", payment_method: "Wise" }),
        order({ id: 2, type: 0, currency: 1, currencyCode: "USD", payment_method: "Zelle" })
      ]
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <OffersPage />
        </MemoryRouter>
      );
    });

    expect(container.querySelector(".orderbook-live-pill")?.textContent).toContain("Current");
    expect(container.querySelector(".orderbook-update-context")?.textContent).toContain("2 offers");
    expect(container.querySelector(".orderbook-update-context")?.textContent).toContain("Updated 2m ago");
    expect(container.querySelectorAll(".offer-row-buy")).toHaveLength(1);
    expect(container.querySelectorAll(".offer-row-sell")).toHaveLength(1);
    expect(container.querySelectorAll(".offer-review-affordance")).toHaveLength(2);
    expect(container.querySelector(".offer-review-affordance")?.textContent).toContain("Review");
    expect(container.querySelector(".orderbook-mobile-filter-heading")?.textContent).toContain("2 shown");
    expect(container.querySelectorAll(".offer-mobile-sort-options button")).toHaveLength(3);
  });

  it("labels cached offers honestly while a live refresh is pending", async () => {
    useOrderbookStore.setState({
      cacheState: "stale",
      lastUpdated: Date.now() - 3 * 24 * 60 * 60_000,
      orders: [order({ id: 1 })],
      refreshing: true
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <OffersPage />
        </MemoryRouter>
      );
    });

    const status = container.querySelector(".orderbook-live-pill");
    expect(status?.textContent).toContain("Cached");
    expect(status?.classList.contains("orderbook-live-pill-confirmed")).toBe(true);
    expect(container.querySelector(".orderbook-update-context")?.textContent).toContain("Updated 3d ago");
  });

  it("starts a fresh Nostr session when the user explicitly refreshes", async () => {
    const refreshOrderbook = vi.fn(async () => undefined);
    useFederationStore.setState({ connection: "nostr" });
    useOrderbookStore.setState({ refreshOrderbook });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <OffersPage />
        </MemoryRouter>
      );
    });
    await vi.waitFor(() => expect(refreshOrderbook).toHaveBeenCalled());
    refreshOrderbook.mockClear();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Refresh public offers"]')?.click();
    });

    await vi.waitFor(() => expect(refreshOrderbook).toHaveBeenCalledOnce());
    expect(nostrOrderbook.resetSession).toHaveBeenCalledOnce();
    expect(refreshOrderbook).toHaveBeenCalledWith(
      [coordinator],
      expect.objectContaining({ connection: "nostr", force: true, network: "mainnet" })
    );
  });

  it("removes an offer from the visible book when its advertised expiry passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T12:00:00.000Z");
    useOrderbookStore.setState({
      orders: [order({ id: 42, amount: 4242, expires_at: "2026-08-08T12:00:10.000Z" })]
    });

    try {
      await act(async () => {
        root.render(
          <MemoryRouter>
            <OffersPage />
          </MemoryRouter>
        );
      });
      expect(container.querySelector(".offer-row")?.textContent).toContain("4,242");

      await act(async () => vi.advanceTimersByTimeAsync(30_000));

      expect(container.querySelector(".offer-row")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

function input(label: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing input: ${label}`);
  return element;
}

async function chooseMethod(methodInput: HTMLInputElement, method: string): Promise<void> {
  await act(async () => {
    methodInput.blur();
    methodInput.focus();
  });
  const option = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((button) =>
    button.textContent?.includes(method)
  );
  if (!option) throw new Error(`Missing payment method: ${method}`);
  await act(async () => option.click());
}

async function chooseCurrency(currency: string): Promise<void> {
  const picker = container
    .querySelector<HTMLDetailsElement>('summary[aria-label="Filter by currency"]')
    ?.closest("details");
  const option = [...(picker?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) =>
    button.textContent?.includes(currency)
  );
  if (!option) throw new Error(`Missing currency: ${currency}`);
  await act(async () => option.click());
}

function currencyValue(): string | undefined {
  return (
    container.querySelector('summary[aria-label="Filter by currency"] .image-select-value')?.textContent ?? undefined
  );
}

const coordinator = {
  shortAlias: "lake",
  longAlias: "TheBigLake",
  color: "#000000",
  url: "https://coordinator.example",
  avatarUrl: "/lake.webp",
  smallAvatarUrl: "/lake.small.webp",
  badgeIcons: [],
  enabled: true,
  online: true
} satisfies CoordinatorSummary;

const orders: PublicOrder[] = [
  order({ id: 1, currency: 2, currencyCode: "EUR", payment_method: "Wise" }),
  order({ id: 2, currency: 1, currencyCode: "USD", payment_method: "Zelle" })
];

function order(overrides: Partial<PublicOrder>): PublicOrder {
  return {
    id: 0,
    type: 0,
    currency: 1,
    currencyCode: "USD",
    amount: 100,
    has_range: false,
    is_swap: false,
    min_amount: 0,
    max_amount: 0,
    payment_method: "Wise",
    premium: 0,
    satoshis: 0,
    maker_nick: "HelpfulVeranda735",
    maker_hash_id: "maker-hash",
    bond_size_sats: 0,
    coordinatorShortAlias: "lake",
    ...overrides
  };
}
