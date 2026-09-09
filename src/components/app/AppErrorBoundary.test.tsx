// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "@/components/app/AppErrorBoundary";
import { ROUTE_TRANSITION_READY_EVENT } from "@/domains/navigation/routeTransition";

let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  delete document.documentElement.dataset.robosatsAppReady;
  window.history.replaceState(null, "", "/");
});

describe("AppErrorBoundary route recovery", () => {
  it("settles pending route feedback when a lazy route fails", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState(null, "", "/#/settings");
    root = createRoot(document.querySelector("#root")!);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let readyPath = "";
    window.addEventListener(
      ROUTE_TRANSITION_READY_EVENT,
      ((event: CustomEvent<{ path: string }>) => {
        readyPath = event.detail.path;
      }) as EventListener,
      { once: true }
    );

    await act(async () => {
      root?.render(
        <AppErrorBoundary scope="route">
          <BrokenRoute />
        </AppErrorBoundary>
      );
    });

    expect(readyPath).toBe("/settings");
    expect(document.body.textContent).toContain("This page could not load");
  });

  it("reveals the rendered interface so a failed route keeps its reload action", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    delete document.documentElement.dataset.robosatsAppReady;
    const interfaceReady = vi.fn();
    window.addEventListener("robosats:app-ready", interfaceReady);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    root = createRoot(document.querySelector("#root")!);

    await act(async () => {
      root?.render(
        <AppErrorBoundary scope="route" routePath="/offers">
          <BrokenRoute />
        </AppErrorBoundary>
      );
    });
    window.removeEventListener("robosats:app-ready", interfaceReady);

    expect(interfaceReady).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.robosatsAppReady).toBe("true");
    expect(document.querySelector("button")?.textContent).toContain("Reload interface");
  });

  it("leaves the boot overlay in charge when the whole app fails to start", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    delete document.documentElement.dataset.robosatsAppReady;
    const interfaceReady = vi.fn();
    window.addEventListener("robosats:app-ready", interfaceReady);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    root = createRoot(document.querySelector("#root")!);

    await act(async () => {
      root?.render(
        <AppErrorBoundary scope="app">
          <BrokenRoute />
        </AppErrorBoundary>
      );
    });
    window.removeEventListener("robosats:app-ready", interfaceReady);

    expect(interfaceReady).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.robosatsAppReady).toBeUndefined();
  });

  it("recovers when navigation changes the route reset key", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(async () => {
      root?.render(
        <AppErrorBoundary key="route-a" routePath="/settings" scope="route">
          <BrokenRoute />
        </AppErrorBoundary>
      );
    });
    expect(document.body.textContent).toContain("This page could not load");

    await act(async () => {
      root?.render(
        <AppErrorBoundary key="route-b" routePath="/offers" scope="route">
          <p>Recovered route</p>
        </AppErrorBoundary>
      );
    });
    expect(document.body.textContent).toContain("Recovered route");
  });
});

function BrokenRoute(): never {
  throw new Error("route chunk unavailable");
}
