import { spawn } from "node:child_process";
import { chromium } from "playwright";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.JOURNEY_AUDIT_PORT ?? "4174", 10);
const baseUrl = `http://${host}:${port}`;
const preview = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "preview", "--", "--host", host, "--port", String(port), "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] }
);
let previewOutput = "";
preview.stdout.on("data", (chunk) => {
  previewOutput += chunk;
});
preview.stderr.on("data", (chunk) => {
  previewOutput += chunk;
});

const cases = [
  ...themeCases("dark"),
  ...themeCases("light"),
  {
    name: "dark-desktop-font-timeout-recovery",
    path: "/settings",
    proEnabled: false,
    theme: "dark",
    fontAssetDelayMs: 7_000,
    expectFontAtReveal: false,
    maxRevealMs: 6_500,
    viewport: { width: 1440, height: 900 }
  }
];
const failures = [];
let browser;

try {
  await waitForPreview();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--disable-dev-shm-usage"],
    headless: true
  });

  for (const scenario of cases) {
    const context = await browser.newContext({ viewport: scenario.viewport });
    await context.addInitScript(
      ({ proEnabled, theme }) => {
        globalThis.__robosatsAuditFontLoadedAtReveal = null;
        globalThis.__robosatsAuditRevealAt = null;
        document.addEventListener(
          "DOMContentLoaded",
          () => {
            const body = document.body;
            const publicSansLoaded = () =>
              [...document.fonts].some(
                (font) => font.family.replace(/["']/g, "").trim() === "Public Sans Variable" && font.status === "loaded"
              );
            const recordFontState = () => {
              if (globalThis.__robosatsAuditFontLoadedAtReveal === null && !body.classList.contains("app-booting")) {
                globalThis.__robosatsAuditFontLoadedAtReveal = publicSansLoaded();
                globalThis.__robosatsAuditRevealAt = performance.now();
              }
            };
            const observer = new MutationObserver(() => {
              recordFontState();
              if (globalThis.__robosatsAuditFontLoadedAtReveal !== null) observer.disconnect();
            });
            observer.observe(body, { attributeFilter: ["class"] });
            recordFontState();
          },
          { once: true }
        );
        localStorage.setItem(
          "robosats_exp_ui_preferences",
          JSON.stringify({
            theme,
            fontScale: 1,
            language: "en",
            qrTheme: "paper"
          })
        );
        localStorage.setItem(
          "robosats_exp_pro_preferences_v1",
          JSON.stringify({
            enabled: proEnabled,
            setupSeen: proEnabled,
            lastView: "robots",
            lastFilter: "all"
          })
        );
      },
      { proEnabled: scenario.proEnabled, theme: scenario.theme }
    );

    const page = await context.newPage();
    const pageErrors = [];
    const assetFailures = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      if (isLocalAssetRequest(request)) {
        assetFailures.push(`${request.url()}: ${request.failure()?.errorText ?? "request failed"}`);
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && isLocalAssetRequest(response.request())) {
        assetFailures.push(`${response.url()}: HTTP ${response.status()}`);
      }
    });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseUrl || url.protocol === "data:" || url.protocol === "blob:") {
        const requestDelayMs = route.request().resourceType() === "font"
          ? (scenario.fontAssetDelayMs ?? scenario.localAssetDelayMs)
          : scenario.localAssetDelayMs;
        if (requestDelayMs && isLocalAssetRequest(route.request())) {
          await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
        }
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });

    try {
      const response = await page.goto(`${baseUrl}${scenario.path}`, {
        timeout: 20_000,
        waitUntil: "domcontentloaded"
      });
      if (!response || response.status() >= 400) {
        throw new Error(`HTTP ${response?.status() ?? "no response"}`);
      }
      await page.locator("html[data-robosats-app-ready='true']").waitFor({ timeout: 15_000 });
      await page.locator("body:not(.app-booting)").waitFor({ timeout: 10_000 });
      await page.locator("#main-content").waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(250);

      const metrics = await page.evaluate(() => {
        const main = document.querySelector("#main-content");
        const publicSansLoaded = [...document.fonts].some(
          (font) => font.family.replace(/["']/g, "").trim() === "Public Sans Variable" && font.status === "loaded"
        );
        return {
          errorBoundary: Boolean(document.querySelector(".app-error-boundary")),
          fontLoaded: publicSansLoaded,
          fontLoadedAtReveal: globalThis.__robosatsAuditFontLoadedAtReveal,
          revealMs: globalThis.__robosatsAuditRevealAt,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
          mainText: main?.textContent?.trim() ?? "",
          latinFontRequested: performance
            .getEntriesByType("resource")
            .some((entry) => entry.name.includes("public-sans-latin-wght-normal")),
          theme: document.documentElement.dataset.theme
        };
      });
      if (metrics.errorBoundary) throw new Error("Application error boundary rendered");
      if (metrics.horizontalOverflow) throw new Error("Page has horizontal viewport overflow");
      if (!metrics.mainText) throw new Error("Main content is empty");
      if (scenario.expectFontAtReveal === false) {
        if (metrics.fontLoadedAtReveal !== false) {
          throw new Error("Font-timeout recovery did not reveal with the fallback font");
        }
        if (!Number.isFinite(metrics.revealMs) || metrics.revealMs > scenario.maxRevealMs) {
          throw new Error(`Font-timeout recovery revealed too late: ${metrics.revealMs ?? "unknown"}ms`);
        }
        const recoveredFont = await page.evaluate(async () => {
          await document.fonts.load('400 1em "Public Sans Variable"', "RoboSats");
          return {
            loaded: [...document.fonts].some(
              (font) => font.family.replace(/["']/g, "").trim() === "Public Sans Variable" && font.status === "loaded"
            ),
            requested: performance
              .getEntriesByType("resource")
              .some((entry) => entry.name.includes("public-sans-latin-wght-normal"))
          };
        });
        if (!recoveredFont.requested) throw new Error("Latin font was not requested after the bounded boot fallback");
        if (!recoveredFont.loaded) throw new Error("Latin font did not recover after the bounded boot fallback");
      } else {
        if (!metrics.latinFontRequested) throw new Error("Latin font was not requested on demand");
        if (!metrics.fontLoaded) throw new Error("Latin font was not loaded after the application became visible");
        if (!metrics.fontLoadedAtReveal) throw new Error("Latin font was not ready when the loading screen left");
      }
      if (metrics.theme !== scenario.theme) throw new Error(`Expected ${scenario.theme} theme, received ${metrics.theme}`);
      if (pageErrors.length > 0) throw new Error(`Runtime errors: ${pageErrors.join(" | ")}`);
      if (assetFailures.length > 0) throw new Error(`Local asset failures: ${assetFailures.join(" | ")}`);

      if (scenario.path === "/offers") {
        const titleLayout = await page.locator(".orderbook-title").evaluate((title) => {
          const header = title.closest(".orderbook-card-header");
          const style = getComputedStyle(title);
          return {
            clipPath: style.clipPath,
            headerPaddingTop: header ? Number.parseFloat(getComputedStyle(header).paddingTop) : Number.NaN,
            position: style.position
          };
        });
        if (scenario.viewport.width <= 500) {
          if (titleLayout.position !== "absolute" || titleLayout.clipPath !== "inset(50%)") {
            throw new Error("Public offers title remains visually exposed on mobile");
          }
        } else if (titleLayout.headerPaddingTop > 12.1) {
          throw new Error(`Public offers header has excessive top padding: ${titleLayout.headerPaddingTop}px`);
        }

        for (const [kind, selector] of [
          ["currency", 'summary[aria-label="Filter by currency"] .filter-any-icon-currency'],
          [
            "payment-method",
            '.filter-select-field:has(input[aria-label="Filter by payment method"]) .image-select-icon .filter-any-icon-payment-method'
          ]
        ]) {
          const icon = page.locator(selector);
          await icon.waitFor({ state: "visible", timeout: 10_000 });
          const rendered = await icon.evaluate((element) => {
            const style = getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            return {
              backgroundColor: style.backgroundColor,
              height: bounds.height,
              maskImage: style.maskImage || style.webkitMaskImage,
              width: bounds.width
            };
          });
          if (rendered.width <= 0 || rendered.height <= 0) throw new Error(`${kind} ANY icon has no rendered size`);
          if (!rendered.maskImage || rendered.maskImage === "none")
            throw new Error(`${kind} ANY icon mask is unavailable`);
          if (rendered.backgroundColor === "rgba(0, 0, 0, 0)") throw new Error(`${kind} ANY icon has no theme color`);
        }
      }

      const modal = page.locator("[data-modal-dialog='true']");
      if (await modal.isVisible()) {
        if (!(await modal.evaluate((element) => element.contains(document.activeElement)))) {
          throw new Error("Open modal does not contain keyboard focus");
        }
      } else {
        await page.locator("body").press("Tab");
        if (!(await page.locator(".skip-link").evaluate((element) => element === document.activeElement))) {
          throw new Error("Skip link is not the first keyboard target");
        }
        await page.locator(".skip-link").press("Enter");
        if (!(await page.locator("#main-content").evaluate((element) => element === document.activeElement))) {
          throw new Error("Skip link did not focus main content");
        }
      }

      if (scenario.expectedPath && new URL(page.url()).pathname !== scenario.expectedPath) {
        throw new Error(`Expected route ${scenario.expectedPath}, received ${new URL(page.url()).pathname}`);
      }
    } catch (error) {
      failures.push({
        case: scenario.name,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => preview.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
}

console.log(JSON.stringify({ cases: cases.length, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;

function themeCases(theme) {
  const variants = [
    {
      name: `${theme}-desktop-offers-tor-like`,
      path: "/offers",
      proEnabled: false,
      fontAssetDelayMs: 800,
      localAssetDelayMs: 150,
      viewport: { width: 1440, height: 900 }
    },
    { name: `${theme}-desktop-create`, path: "/create", proEnabled: false, viewport: { width: 1440, height: 900 } },
    { name: `${theme}-desktop-settings`, path: "/settings", proEnabled: false, viewport: { width: 1440, height: 900 } },
    { name: `${theme}-desktop-garage`, path: "/", expectedPath: "/garage", proEnabled: false, viewport: { width: 1440, height: 900 } },
    { name: `${theme}-desktop-pro`, path: "/", expectedPath: "/pro", proEnabled: true, viewport: { width: 1440, height: 900 } },
    { name: `${theme}-mobile-offers`, path: "/offers", proEnabled: false, viewport: { width: 390, height: 844 } },
    { name: `${theme}-mobile-settings`, path: "/settings", proEnabled: false, viewport: { width: 390, height: 844 } },
    { name: `${theme}-mobile-garage`, path: "/", expectedPath: "/garage", proEnabled: false, viewport: { width: 390, height: 844 } },
    { name: `${theme}-mobile-pro`, path: "/", expectedPath: "/pro", proEnabled: true, viewport: { width: 390, height: 844 } }
  ];
  return variants.map((scenario) => ({ ...scenario, theme }));
}

function isLocalAssetRequest(request) {
  const url = new URL(request.url());
  return url.origin === baseUrl && ["font", "image", "script", "stylesheet"].includes(request.resourceType());
}

async function waitForPreview() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) {
      throw new Error(`Vite preview exited early.\n${previewOutput}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for Vite preview.\n${previewOutput}`);
}
