// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/ui/dialog";

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div class="app-runtime"><div id="root"></div></div>';
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
});

describe("Dialog document isolation", () => {
  it("locks background scroll and restores the exact position after the last nested dialog closes", async () => {
    let scrollY = 320;
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((_x, top) => {
      scrollY = Number(top);
    });

    await renderDialogs(2);

    const appRoot = document.querySelector<HTMLElement>(".app-runtime")!;
    const overlays = document.querySelectorAll<HTMLElement>("[data-dialog-overlay='true']");
    expect(appRoot.inert).toBe(true);
    expect(overlays[0]?.inert).toBe(true);
    expect(overlays[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(overlays[1]?.inert).toBe(false);
    expect(overlays[1]?.hasAttribute("aria-hidden")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-320px");

    await renderDialogs(1);
    expect(appRoot.inert).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-dialog-overlay='true']")?.inert).toBe(false);
    expect(document.body.style.position).toBe("fixed");

    await renderDialogs(0);
    expect(appRoot.inert).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.body.style.position).toBe("");
    expect(scrollTo).toHaveBeenLastCalledWith(0, 320);
  });

  it("does not restore the previous scroll position after hash-route navigation", async () => {
    let scrollY = 240;
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((_x, top) => {
      scrollY = Number(top);
    });
    window.history.replaceState(null, "", "/#/offers");

    await renderDialogs(1);
    window.history.replaceState(null, "", "/#/settings");
    await renderDialogs(0);

    expect(scrollTo).not.toHaveBeenCalled();
  });
});

async function renderDialogs(count: number): Promise<void> {
  await act(async () => {
    root?.render(
      <>
        {Array.from({ length: count }, (_, index) => (
          <Dialog
            ariaLabel={`Dialog ${index + 1}`}
            key={index}
            onClose={() => undefined}
            overlayClassName="test-overlay"
            panelClassName="test-panel"
          >
            <button type="button">Action {index + 1}</button>
          </Dialog>
        ))}
      </>
    );
  });
}
