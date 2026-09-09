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
    maxRevealMs: 2_500,
    viewport: { width: 1440, height: 900 }
  },
  {
    name: "dark-statistics-stylesheet-delay",
    path: "/statistics",
    proEnabled: false,
    theme: "dark",
    styleChunk: "StatisticsPage.",
    styleAssetDelayMs: 5_000,
    assertStylePending: true,
    viewport: { width: 1440, height: 900 }
  },
  {
    name: "dark-statistics-stylesheet-failure",
    path: "/statistics",
    proEnabled: false,
    theme: "dark",
    styleChunk: "StatisticsPage.",
    failStyle: true,
    styleFailureAttempts: 1,
    reloadRecovery: true,
    viewport: { width: 1440, height: 900 }
  },
  {
    name: "dark-font-request-failure-recovery",
    path: "/settings",
    proEnabled: false,
    theme: "dark",
    failFont: true,
    expectFontAtReveal: false,
    maxRevealMs: 2_500,
    viewport: { width: 1440, height: 900 }
  },
  {
    // A background preload of another route may fail. That must stay in the
    // background: the current route keeps working, no error screen appears, and the
    // document is never reloaded to paper over it.
    name: "dark-blocked-optional-offers-chunk",
    path: "/settings",
    proEnabled: false,
    theme: "dark",
    blockChunk: "robosats-exp.offers~OffersPage~",
    viewport: { width: 1440, height: 900 }
  },
  {
    // Fleet synchronisation is required work. When its chunk cannot be fetched the
    // browser will not fetch it again, so the page has to say so and hand the reload
    // to the user, who then gets a working desk.
    name: "dark-pro-runtime-chunk-reload-recovery",
    path: "/offers",
    proEnabled: true,
    theme: "dark",
    blockChunk: "robosats-exp.proRuntime.",
    blockChunkBeforeReady: true,
    reloadRecovery: true,
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
    const chunkRequests = [];
    const blockedChunks = [];
    const styleRequests = [];
    const completedStyles = [];
    const failedStyles = [];
    const failedFonts = [];
    const navigations = [];
    let latinFontRequested = false;
    let appReadyForAssetAudit = false;
    const matchesBlockPattern = (url) =>
      Boolean(scenario.blockChunk) && new URL(url).pathname.includes(scenario.blockChunk);
    const shouldBlockChunk = (url) =>
      matchesBlockPattern(url) &&
      (scenario.blockChunkBeforeReady || appReadyForAssetAudit) &&
      blockedChunks.length < (scenario.blockChunkAttempts ?? 1);
    const matchesStylePattern = (url) =>
      Boolean(scenario.styleChunk) && new URL(url).pathname.includes(scenario.styleChunk);
    const isMatchingStylesheet = (url, resourceType) => resourceType === "stylesheet" && matchesStylePattern(url);
    const isExpectedFontFailure = (url) =>
      Boolean(scenario.failFont) && new URL(url).pathname.includes("public-sans-latin-wght-normal");
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    page.on("requestfailed", (request) => {
      // A chunk this audit aborts on purpose is an expected failure, not an asset
      // failure. `blockedChunks` records only the requests the route handler aborted.
      if (
        matchesBlockPattern(request.url()) ||
        isMatchingStylesheet(request.url(), request.resourceType()) ||
        isExpectedFontFailure(request.url())
      )
        return;
      if (isLocalAssetRequest(request)) {
        assetFailures.push(`${request.url()}: ${request.failure()?.errorText ?? "request failed"}`);
      }
    });
    page.on("response", (response) => {
      if (isMatchingStylesheet(response.url(), response.request().resourceType()) && response.status() < 400) {
        completedStyles.push(response.url());
      }
      if (
        response.status() >= 400 &&
        !matchesBlockPattern(response.url()) &&
        !isMatchingStylesheet(response.url(), response.request().resourceType()) &&
        !isExpectedFontFailure(response.url()) &&
        isLocalAssetRequest(response.request())
      ) {
        assetFailures.push(`${response.url()}: HTTP ${response.status()}`);
      }
    });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseUrl || url.protocol === "data:" || url.protocol === "blob:") {
        if (url.pathname.includes("public-sans-latin-wght-normal")) latinFontRequested = true;
        if (isMatchingStylesheet(url.href, route.request().resourceType())) {
          styleRequests.push(url.href);
          if (scenario.failStyle && failedStyles.length < (scenario.styleFailureAttempts ?? 1)) {
            failedStyles.push(url.href);
            await route.abort("blockedbyclient");
            return;
          }
        }
        const requestDelayMs =
          route.request().resourceType() === "font"
            ? (scenario.fontAssetDelayMs ?? scenario.localAssetDelayMs)
            : route.request().resourceType() === "stylesheet" && matchesStylePattern(url.href)
              ? (scenario.styleAssetDelayMs ?? scenario.localAssetDelayMs)
              : scenario.localAssetDelayMs;
        if (requestDelayMs && isLocalAssetRequest(route.request())) {
          await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
        }
        if (matchesBlockPattern(url.href)) {
          chunkRequests.push(url.href);
          if (shouldBlockChunk(url.href)) {
            blockedChunks.push(url.href);
            await route.abort("blockedbyclient");
            return;
          }
        }
        if (
          scenario.failFont &&
          route.request().resourceType() === "font" &&
          url.pathname.includes("public-sans-latin-wght-normal")
        ) {
          failedFonts.push(url.href);
          await route.abort("blockedbyclient");
          return;
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
      if (scenario.assertStylePending) {
        const pendingDeadline = Date.now() + 5_000;
        while (styleRequests.length === 0 && Date.now() < pendingDeadline) {
          await page.waitForTimeout(25);
        }
        if (styleRequests.length === 0) throw new Error(`Stylesheet ${scenario.styleChunk} was never requested`);
        await page.waitForTimeout(100);
        if (styleRequests.length !== 1 || completedStyles.length > 0) {
          throw new Error(
            `The delayed Statistics stylesheet did not remain pending during the probe (${styleRequests.length} requests, ${completedStyles.length} responses)`
          );
        }
        const pendingState = await page.evaluate(() => ({
          statisticsPage: Boolean(document.querySelector(".statistics-page")),
          routeFallback: Boolean(document.querySelector(".route-fallback"))
        }));
        if (pendingState.statisticsPage && !pendingState.routeFallback) {
          throw new Error("Statistics content rendered before its stylesheet finished loading");
        }
      }
      await page.locator("html[data-robosats-app-ready='true']").waitFor({ timeout: 15_000 });
      await page.locator("body:not(.app-booting)").waitFor({ timeout: 10_000 });
      await page.locator("#main-content").waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(250);
      appReadyForAssetAudit = true;

      if (scenario.blockChunk) {
        // State only this document can hold. A reload — wanted or not — erases both.
        // Written without focusing anything: focusing and blurring would move the
        // sequential focus starting point and skew the keyboard checks below.
        await page.evaluate(() => {
          const probe = document.createElement("input");
          probe.id = "audit-sentinel-input";
          probe.setAttribute("aria-label", "audit sentinel");
          probe.style.cssText = "position:fixed;top:0;left:-200px;width:100px;height:20px";
          probe.value = "kept";
          document.body.appendChild(probe);
          window.__robosatsAuditSentinel = "kept";
        });
      }
      const navigationsBeforeFailure = navigations.length;

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
      if (metrics.errorBoundary && !scenario.failStyle) throw new Error("Application error boundary rendered");
      if (metrics.horizontalOverflow) throw new Error("Page has horizontal viewport overflow");
      if (!metrics.mainText) throw new Error("Main content is empty");
      if (scenario.expectFontAtReveal === false) {
        if (metrics.fontLoadedAtReveal !== false) {
          throw new Error("Font-timeout recovery did not reveal with the fallback font");
        }
        if (!Number.isFinite(metrics.revealMs) || metrics.revealMs > scenario.maxRevealMs) {
          throw new Error(`Font-timeout recovery revealed too late: ${metrics.revealMs ?? "unknown"}ms`);
        }
        if (!scenario.failFont) {
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
        }
      } else {
        if (scenario.maxRevealMs && (!Number.isFinite(metrics.revealMs) || metrics.revealMs > scenario.maxRevealMs)) {
          throw new Error(`Interface revealed too late: ${metrics.revealMs ?? "unknown"}ms`);
        }
        if (!latinFontRequested && !metrics.latinFontRequested) {
          throw new Error("Latin font was not requested on demand");
        }
        if (scenario.expectFontAtReveal !== "optional" && !metrics.fontLoaded) {
          throw new Error("Latin font was not loaded after the application became visible");
        }
        if (scenario.expectFontAtReveal !== "optional" && !metrics.fontLoadedAtReveal) {
          throw new Error("Latin font was not ready when the loading screen left");
        }
      }
      if (scenario.failFont) {
        if (latinFontRequested === false) throw new Error("Failed font case never requested the Latin font");
        if (failedFonts.length === 0) throw new Error("Failed font case did not abort the Latin font request");
        if (metrics.fontLoadedAtReveal !== false) throw new Error("Failed font case did not reveal with fallback text");
      }
      if (metrics.theme !== scenario.theme)
        throw new Error(`Expected ${scenario.theme} theme, received ${metrics.theme}`);
      if (pageErrors.length > 0 && !scenario.failStyle) throw new Error(`Runtime errors: ${pageErrors.join(" | ")}`);
      if (assetFailures.length > 0) throw new Error(`Local asset failures: ${assetFailures.join(" | ")}`);

      if (scenario.styleChunk) {
        const styleDeadline = Date.now() + 8_000;
        while (styleRequests.length === 0 && Date.now() < styleDeadline) {
          await page.waitForTimeout(100);
        }
        if (styleRequests.length === 0) throw new Error(`Stylesheet ${scenario.styleChunk} was never requested`);
        if (scenario.failStyle) {
          if (failedStyles.length === 0)
            throw new Error(`Stylesheet ${scenario.styleChunk} was not failed as requested`);
          const failedState = await page.evaluate(() => ({
            errorBoundary: Boolean(document.querySelector(".app-error-boundary")),
            statisticsPage: Boolean(document.querySelector(".statistics-page")),
            mainText: document.querySelector("#main-content")?.textContent?.trim() ?? ""
          }));
          if (!failedState.errorBoundary || failedState.statisticsPage || !failedState.mainText) {
            throw new Error("A failed Statistics stylesheet did not enter the recoverable route failure state");
          }
          if (!scenario.reloadRecovery) continue;
          const navigationBeforeReload = navigations.length;
          pageErrors.length = 0;
          await page.locator(".app-error-boundary button").click();
          await page.locator(".statistics-page").waitFor({ state: "visible", timeout: 15_000 });
          const recoveredStyle = await page
            .locator(".statistics-page")
            .evaluate((element) => getComputedStyle(element).getPropertyValue("--statistics-chart-height").trim());
          if (recoveredStyle !== "18rem") throw new Error("Statistics stylesheet did not apply after recovery reload");
          if (failedStyles.length !== 1 || styleRequests.length < 2) {
            throw new Error("Statistics stylesheet recovery did not perform one failed request followed by a retry");
          }
          if (navigations.length <= navigationBeforeReload)
            throw new Error("Statistics recovery did not reload the document");
          if (pageErrors.length > 0)
            throw new Error(`Runtime errors after Statistics stylesheet recovery: ${pageErrors.join(" | ")}`);
        } else {
          await page.locator(".statistics-page").waitFor({ state: "visible", timeout: 10_000 });
          const styled = await page
            .locator(".statistics-page")
            .evaluate((element) => getComputedStyle(element).getPropertyValue("--statistics-chart-height").trim());
          if (styled !== "18rem")
            throw new Error(`Statistics stylesheet did not apply after delay: ${styled || "missing"}`);
        }
      }

      if (scenario.blockChunk) {
        const deadline = Date.now() + 8_000;
        while (blockedChunks.length === 0 && Date.now() < deadline) {
          await page.waitForTimeout(100);
        }
        if (blockedChunks.length === 0) {
          throw new Error(`Chunk ${scenario.blockChunk} was never requested, so the case proves nothing`);
        }
        // Judge the page only after the rejection has reached every handler.
        await page.waitForTimeout(750);

        if (!scenario.reloadRecovery) {
          const afterPreloadFailure = await page.evaluate(() => ({
            sentinel: window.__robosatsAuditSentinel ?? null,
            typed: document.querySelector("#audit-sentinel-input")?.value ?? null,
            errorBoundary: Boolean(document.querySelector(".app-error-boundary")),
            mainText: document.querySelector("#main-content")?.textContent?.trim() ?? ""
          }));
          if (afterPreloadFailure.sentinel !== "kept" || afterPreloadFailure.typed !== "kept") {
            throw new Error("Blocking an optional chunk lost the page state, so the document reloaded");
          }
          if (navigations.length > navigationsBeforeFailure) {
            throw new Error(
              `Blocking an optional chunk navigated the document ${navigations.length - navigationsBeforeFailure} times`
            );
          }
          if (afterPreloadFailure.errorBoundary) {
            throw new Error("A failed optional route preload revealed the application error screen");
          }
          if (!afterPreloadFailure.mainText) {
            throw new Error("A failed optional route preload left the page empty");
          }
          if (pageErrors.length > 0) {
            throw new Error(`Runtime errors after a failed optional preload: ${pageErrors.join(" | ")}`);
          }
        } else {
          const notice = page.locator("[data-runtime-notice]");
          await notice.waitFor({ state: "visible", timeout: 10_000 });
          const noticeText = (await notice.textContent()) ?? "";
          if (!noticeText.toLowerCase().includes("fleet")) {
            throw new Error(`The recovery notice did not name the work that is missing: ${noticeText}`);
          }
          if (navigations.length > navigationsBeforeFailure) {
            throw new Error("The document reloaded on its own after the required runtime chunk failed");
          }

          await page.locator("[data-runtime-reload]").click();
          await page.locator("html[data-robosats-app-ready='true']").waitFor({ timeout: 20_000 });
          await page.waitForTimeout(1_000);

          if (navigations.length <= navigationsBeforeFailure) {
            throw new Error("The reload control did not reload the document");
          }
          if (chunkRequests.length < 2) {
            throw new Error(
              `${scenario.blockChunk} was requested ${chunkRequests.length} time(s); the reload did not fetch it again`
            );
          }
          if (await notice.isVisible()) {
            throw new Error("The recovery notice survived a reload that should have started the runtime");
          }
          if (pageErrors.length > 0) {
            throw new Error(`Runtime errors after the recovery reload: ${pageErrors.join(" | ")}`);
          }
        }
      }

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
      expectFontAtReveal: "optional",
      maxRevealMs: 2_500,
      viewport: { width: 1440, height: 900 }
    },
    { name: `${theme}-desktop-create`, path: "/create", proEnabled: false, viewport: { width: 1440, height: 900 } },
    { name: `${theme}-desktop-settings`, path: "/settings", proEnabled: false, viewport: { width: 1440, height: 900 } },
    {
      name: `${theme}-desktop-statistics`,
      path: "/statistics",
      proEnabled: false,
      viewport: { width: 1440, height: 900 }
    },
    {
      name: `${theme}-desktop-garage`,
      path: "/",
      expectedPath: "/garage",
      proEnabled: false,
      viewport: { width: 1440, height: 900 }
    },
    {
      name: `${theme}-desktop-pro`,
      path: "/",
      expectedPath: "/pro",
      proEnabled: true,
      viewport: { width: 1440, height: 900 }
    },
    { name: `${theme}-mobile-offers`, path: "/offers", proEnabled: false, viewport: { width: 390, height: 844 } },
    { name: `${theme}-mobile-settings`, path: "/settings", proEnabled: false, viewport: { width: 390, height: 844 } },
    {
      name: `${theme}-mobile-garage`,
      path: "/",
      expectedPath: "/garage",
      proEnabled: false,
      viewport: { width: 390, height: 844 }
    },
    {
      name: `${theme}-mobile-pro`,
      path: "/",
      expectedPath: "/pro",
      proEnabled: true,
      viewport: { width: 390, height: 844 }
    }
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
