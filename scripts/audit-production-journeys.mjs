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
  ...themeCases("light")
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
    await context.addInitScript(({ proEnabled, theme }) => {
      localStorage.setItem("robosats_exp_ui_preferences", JSON.stringify({
        theme,
        fontScale: 1,
        language: "en",
        qrTheme: "paper"
      }));
      localStorage.setItem("robosats_exp_pro_preferences_v1", JSON.stringify({
        enabled: proEnabled,
        setupSeen: proEnabled,
        lastView: "robots",
        lastFilter: "all"
      }));
    }, { proEnabled: scenario.proEnabled, theme: scenario.theme });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseUrl || url.protocol === "data:" || url.protocol === "blob:") {
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
      await page.locator("#main-content").waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(250);

      const metrics = await page.evaluate(() => {
        const main = document.querySelector("#main-content");
        return {
          errorBoundary: Boolean(document.querySelector(".app-error-boundary")),
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
          mainText: main?.textContent?.trim() ?? "",
          theme: document.documentElement.dataset.theme
        };
      });
      if (metrics.errorBoundary) throw new Error("Application error boundary rendered");
      if (metrics.horizontalOverflow) throw new Error("Page has horizontal viewport overflow");
      if (!metrics.mainText) throw new Error("Main content is empty");
      if (metrics.theme !== scenario.theme) throw new Error(`Expected ${scenario.theme} theme, received ${metrics.theme}`);
      if (pageErrors.length > 0) throw new Error(`Runtime errors: ${pageErrors.join(" | ")}`);

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
    { name: `${theme}-desktop-offers`, path: "/offers", proEnabled: false, viewport: { width: 1440, height: 900 } },
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
