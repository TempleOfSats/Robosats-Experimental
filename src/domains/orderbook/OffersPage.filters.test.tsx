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
    error: undefined,
    refreshOrderbook: vi.fn(async () => undefined)
  });
  useGarageStore.setState({
    slots: [],
    currentToken: undefined,
    hydrated: true,
    hydrate: vi.fn()
  });
  useProPreferencesStore.setState(defaultProPreferences);
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
