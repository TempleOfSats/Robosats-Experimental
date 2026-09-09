// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportRuntimeUnavailable } from "@/app/runtimeNotice";

const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
  (match) => match[1]
);
const bodyMarkup =
  indexHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1]?.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "") ?? "";

const componentsCss = readFileSync(resolve(process.cwd(), "src/styles/components.css"), "utf8");

const notice = () => document.querySelector<HTMLElement>("[data-runtime-notice]");
const reloadControl = () => document.querySelector<HTMLButtonElement>("[data-runtime-reload]");
const cleanups: Array<() => void> = [];

function report(message: string): () => void {
  const clear = reportRuntimeUnavailable(message);
  cleanups.push(clear);
  return clear;
}

/** Load the document chrome exactly as index.html ships it, notice wiring included. */
function startDocument(): void {
  document.head.querySelectorAll("link[data-robosats-app-style], script[src]").forEach((element) => element.remove());
  document.body.className = "app-booting";
  // The banner is hidden by attribute, so the stylesheet has to agree that it is
  // off screen; a display rule that overrides [hidden] would put it on every page.
  const style = document.createElement("style");
  style.textContent = componentsCss;
  document.head.appendChild(style);
  document.body.innerHTML = bodyMarkup;
  for (const code of inlineScripts) {
    new Function("window", "document", "performance", "navigator", "localStorage", "requestAnimationFrame", code)(
      window,
      document,
      performance,
      window.navigator,
      window.localStorage,
      window.requestAnimationFrame
    );
  }
}

afterEach(() => {
  cleanups.splice(0).forEach((clear) => clear());
  // Let the boot overlay finish so its animation loop stops between tests.
  window.dispatchEvent(new Event("robosats:app-ready"));
});

describe("the runtime notice", () => {
  it("stays out of the way while background work is healthy", () => {
    startDocument();
    expect(notice()?.hidden).toBe(true);
    expect(notice()?.getAttribute("role")).toBe("status");
    expect(getComputedStyle(notice() as Element).display).toBe("none");
  });

  it("names the work that is missing when a required runtime cannot start", () => {
    startDocument();
    report("RoboSats could not start Fleet synchronization.");

    expect(notice()?.hidden).toBe(false);
    expect(getComputedStyle(notice() as Element).display).not.toBe("none");
    expect(notice()?.textContent).toContain("Fleet synchronization");
  });

  it("reloads the document only when the user asks for it", () => {
    startDocument();
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "https://robotsats.example/pro", replace }
    });

    report("RoboSats could not start its background refresh.");
    expect(notice()?.hidden).toBe(false);
    reloadControl()?.click();

    expect(replace).toHaveBeenCalledOnce();
    expect(String(replace.mock.calls[0]?.[0])).toContain("reload=");
  });

  it("removes a stopped owner's message without hiding another failure", () => {
    startDocument();
    const clearFleet = report("Fleet unavailable.");
    const clearRefresh = report("Background refresh unavailable.");

    clearFleet();
    clearFleet();
    expect(notice()?.hidden).toBe(false);
    expect(notice()?.textContent).not.toContain("Fleet unavailable.");
    expect(notice()?.textContent).toContain("Background refresh unavailable.");

    clearRefresh();
    expect(notice()?.hidden).toBe(true);
    expect(notice()?.querySelector(".app-runtime-notice-copy")?.textContent).toBe("");
  });

  it("tracks separate owners even when their messages match", () => {
    startDocument();
    const clearFirst = report("Runtime unavailable.");
    const clearSecond = report("Runtime unavailable.");

    clearFirst();
    expect(notice()?.hidden).toBe(false);
    expect(notice()?.textContent).toContain("Runtime unavailable.");

    clearSecond();
    expect(notice()?.hidden).toBe(true);
  });
});
