import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:5174";
const outputDir = new URL("../artifacts/trade-audit/", import.meta.url);
const scenarios = [
  "maker-bond",
  "public",
  "paused",
  "taker-wait",
  "take",
  "cancelled",
  "expired",
  "setup-buyer",
  "setup-seller",
  "escrow-wait",
  "escrow-lock",
  "payout-submit",
  "payout-wait",
  "chat-buyer",
  "chat-seller",
  "dispute",
  "dispute-peer-wait",
  "collaborative-cancel",
  "resolution",
  "payout",
  "payout-seller",
  "success",
  "routing-auto",
  "routing-retry",
  "routing-seller",
  "dispute-won-taker",
  "dispute-lost-maker",
  "dispute-won-maker",
  "dispute-lost-taker",
];
const requestedScenarios = (process.env.AUDIT_SCENARIOS ?? "")
  .split(",")
  .map((scenario) => scenario.trim())
  .filter(Boolean);
if (requestedScenarios.length > 0) {
  scenarios.splice(
    0,
    scenarios.length,
    ...scenarios.filter((scenario) => requestedScenarios.includes(scenario)),
  );
}
const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
  { name: "wide", width: 1600, height: 1000 },
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--disable-dev-shm-usage", "--disable-gpu"],
  headless: true,
});
const report = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });

    for (const scenario of scenarios) {
      const page = await context.newPage();
      const errors = [];
      const onConsole = (message) => {
        if (message.type() === "error")
          errors.push(`console: ${message.text()}`);
      };
      const onPageError = (error) => errors.push(`page: ${error.message}`);
      page.on("console", onConsole);
      page.on("pageerror", onPageError);

      let response;
      let metrics = {
        bodyWidth: 0,
        clipped: false,
        horizontalOverflow: false,
        layoutColumns: "",
        pageHeight: 0,
        viewportWidth: viewport.width,
        visiblePanels: 0,
      };

      try {
        response = await page.goto(
          `${baseUrl}/order/lake/95955?tradePreview=${scenario}`,
          { waitUntil: "networkidle", timeout: 30_000 },
        );
        await page
          .locator(".trade-layout")
          .waitFor({ state: "visible", timeout: 10_000 });
        await page.waitForTimeout(300);

        if (scenario === "take") {
          await page.getByRole("button", { name: /Cancel order/ }).click();
          await page.locator(".confirm-sheet").waitFor({ state: "visible" });
          await page
            .locator(".confirm-sheet")
            .getByRole("button", { name: "Cancel" })
            .click();
          await page.locator(".confirm-sheet").waitFor({ state: "hidden" });
        }

        if (
          ["maker-bond", "take", "setup-seller", "escrow-lock"].includes(
            scenario,
          )
        ) {
          const details = page.locator(".invoice-details");
          await details.locator("summary").click();
          if (!(await details.evaluate((element) => element.open))) {
            throw new Error("Invoice details did not open");
          }
          await details.locator("summary").click();
        }

        metrics = await page.evaluate(() => {
          const root = document.documentElement;
          const layout = document.querySelector(".trade-layout");
          const panels = [...document.querySelectorAll(".trade-panel-slot")];
          const visiblePanels = panels.filter((panel) => {
            const style = getComputedStyle(panel);
            const rect = panel.getBoundingClientRect();
            return (
              style.display !== "none" && rect.width > 0 && rect.height > 0
            );
          });
          const clipped = visiblePanels.some((panel) => {
            const rect = panel.getBoundingClientRect();
            return rect.left < -1 || rect.right > innerWidth + 1;
          });
          const overflowingElements = [...document.querySelectorAll("main *")]
            .filter((element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return false;
              if (
                ["auto", "scroll", "hidden", "clip"].includes(style.overflowX)
              )
                return false;
              return element.scrollWidth > element.clientWidth + 2;
            })
            .slice(0, 8)
            .map(
              (element) =>
                `${element.tagName.toLowerCase()}.${element.className}`,
            );

          return {
            bodyWidth: document.body.scrollWidth,
            clipped,
            horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
            layoutColumns: layout
              ? getComputedStyle(layout).gridTemplateColumns
              : "",
            pageHeight: root.scrollHeight,
            overflowingElements,
            viewportWidth: root.clientWidth,
            visiblePanels: visiblePanels.length,
          };
        });
      } catch (error) {
        errors.push(`audit: ${error.message}`);
      }

      await page.screenshot({
        path: new URL(`${viewport.name}-${scenario}.png`, outputDir).pathname,
        fullPage: false,
      });
      report.push({
        errors,
        httpStatus: response?.status() ?? 0,
        scenario,
        viewport: viewport.name,
        ...metrics,
      });

      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      await page.close();
    }

    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(
  new URL("report.json", outputDir),
  `${JSON.stringify(report, null, 2)}\n`,
);

const failures = report.filter(
  (entry) =>
    entry.httpStatus >= 400 ||
    entry.errors.length > 0 ||
    entry.horizontalOverflow ||
    entry.clipped ||
    entry.overflowingElements.length > 0 ||
    entry.visiblePanels < 1,
);

console.log(JSON.stringify({ cases: report.length, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
