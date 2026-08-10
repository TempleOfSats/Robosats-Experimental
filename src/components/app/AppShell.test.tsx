// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/app/AppSidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/app/DesktopTitleBar", () => ({ DesktopTitleBar: () => null }));
vi.mock("@/domains/transport/tauriBridge", () => ({ isTauriDesktop: () => false }));

import { AppShell } from "@/components/app/AppShell";
import { beginRouteTransition, finishRouteTransition } from "@/domains/navigation/routeTransition";

const platform = { client: "web", mode: "basic", router: "memory" } as const;
let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AppShell navigation feedback", () => {
  it("starts new entries at the top and restores POP entries", async () => {
    let scrollY = 0;
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    vi.spyOn(window, "scrollTo").mockImplementation((_x, top) => {
      scrollY = Number(top);
    });

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/offers"]}>
          <AppShell platform={platform}>
            <NavigationHarness />
          </AppShell>
        </MemoryRouter>
      );
    });

    window.scrollTo(0, 410);
    await click("Open settings");
    expect(page()).toBe("/settings");
    expect(scrollY).toBe(0);

    window.scrollTo(0, 260);
    await click("Back");
    expect(page()).toBe("/offers");
    expect(scrollY).toBe(410);

    await click("Forward");
    expect(page()).toBe("/settings");
    expect(scrollY).toBe(260);
  });

  it("shows transition feedback only when a route is perceptibly delayed", async () => {
    vi.useFakeTimers();
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/offers"]}>
          <AppShell platform={platform}>
            <span>Current content</span>
          </AppShell>
        </MemoryRouter>
      );
    });

    act(() => beginRouteTransition("/settings"));
    expect(container.querySelector(".app-route-transition")).toBeNull();

    await act(async () => vi.advanceTimersByTimeAsync(179));
    expect(container.querySelector(".app-route-transition")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(container.querySelector(".app-route-transition")?.textContent).toContain("Opening settings");

    act(() => finishRouteTransition("/settings"));
    expect(container.querySelector(".app-route-transition")).toBeNull();

    act(() => beginRouteTransition("/create"));
    act(() => finishRouteTransition("/create"));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(container.querySelector(".app-route-transition")).toBeNull();
  });

  it("discards stale feedback when another route settles after an interrupted navigation", async () => {
    vi.useFakeTimers();
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={["/offers"]}>
          <AppShell platform={platform}>
            <span>Offers</span>
          </AppShell>
        </MemoryRouter>
      );
    });

    act(() => beginRouteTransition("/settings"));
    act(() => finishRouteTransition("/offers"));
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(container.querySelector(".app-route-transition")).toBeNull();
  });
});

function NavigationHarness() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => finishRouteTransition(location.pathname), [location.pathname]);

  return (
    <div>
      <output aria-label="Current page">{location.pathname}</output>
      <button type="button" onClick={() => navigate("/settings")}>
        Open settings
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        Forward
      </button>
    </div>
  );
}

function page(): string | null {
  return container.querySelector('output[aria-label="Current page"]')?.textContent ?? null;
}

async function click(label: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}
