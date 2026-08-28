// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
  (match) => match[1]
);
const bodyMarkup =
  indexHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1]?.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "") ?? "";

const waitForMessage = (expected: string, timeoutMs = 1_000) =>
  new Promise<string>((resolveText) => {
    const started = Date.now();
    const poll = () => {
      const text = document.querySelector(".app-boot-message")?.textContent ?? "";
      if (text === expected || Date.now() - started > timeoutMs) resolveText(text);
      else window.setTimeout(poll, 10);
    };
    poll();
  });

const startBootOverlay = () => {
  // Drop fixtures from earlier tests; the overlay tracks style links in head.
  document.head.querySelectorAll("link[data-robosats-app-style], script[src]").forEach((element) => element.remove());
  document.body.className = "app-booting";
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
};

const bootRetry = () => document.querySelector<HTMLButtonElement>(".app-boot-retry");

const fireResourceError = (element: Element) => element.dispatchEvent(new Event("error"));

afterEach(() => {
  // Let the boot overlay finish so its animation loop stops between tests.
  window.dispatchEvent(new Event("robosats:app-ready"));
  window.setTimeout(() => undefined, 0);
});

describe("boot overlay failure recovery", () => {
  it("shows retry immediately when the application script fails to load", async () => {
    startBootOverlay();
    expect(bootRetry()?.hidden).toBe(true);

    const script = document.createElement("script");
    script.src = "/assets/d718862720c9/robosats-exp.index.B11L5_s8.js";
    document.head.appendChild(script);
    fireResourceError(script);

    expect(bootRetry()?.hidden).toBe(false);
    expect(await waitForMessage("The private interface could not be loaded. Try again.")).toBe(
      "The private interface could not be loaded. Try again."
    );

    // A late app-ready signal must not dismiss the overlay after a failed bundle.
    window.dispatchEvent(new Event("robosats:app-ready"));
    await new Promise((resolveDone) => window.setTimeout(resolveDone, 200));
    expect(document.querySelector("#app-boot")).toBeTruthy();
  });

  it("keeps the retry message while waiting instead of cycling status messages", async () => {
    startBootOverlay();
    const link = document.createElement("link");
    link.rel = "preload";
    link.setAttribute("as", "style");
    link.setAttribute("data-robosats-app-style", "");
    link.href = "/assets/d718862720c9/robosats-exp.index.utbw5-VH.css";
    document.head.appendChild(link);

    fireResourceError(link);

    expect(bootRetry()?.hidden).toBe(false);
    expect(await waitForMessage("The private interface could not be loaded. Try again.")).toBe(
      "The private interface could not be loaded. Try again."
    );

    // The rotating status messages must not clobber the failure message.
    await new Promise((resolveStable) => window.setTimeout(resolveStable, 2_100));
    expect(document.querySelector(".app-boot-message")?.textContent).toBe(
      "The private interface could not be loaded. Try again."
    );
  });

  it("falls back to the inline brand mark when the logo asset fails", async () => {
    startBootOverlay();
    const mark = document.querySelector<HTMLImageElement>(".app-boot-mark img");
    expect(mark).toBeTruthy();
    expect(mark?.src).not.toMatch(/^data:/);

    fireResourceError(mark!);

    expect(mark!.src).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(mark!.src)).toContain("<svg");
  });

  it("still finishes on the happy path", async () => {
    startBootOverlay();
    window.dispatchEvent(new Event("robosats:app-ready"));

    const overlay = document.querySelector<HTMLElement>("#app-boot");
    const started = Date.now();
    while (overlay?.dataset.state !== "leaving" && Date.now() - started < 2_000) {
      await new Promise((resolveTick) => window.setTimeout(resolveTick, 20));
    }

    expect(overlay?.dataset.state).toBe("leaving");
    expect(document.querySelector(".app-boot-percent")?.textContent).toBe("100%");
    expect(document.body.classList.contains("app-booting")).toBe(false);
  });
});
