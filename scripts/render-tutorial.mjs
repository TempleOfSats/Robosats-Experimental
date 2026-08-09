import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const publish = process.argv.includes("--publish");
const indexPath = fileURLToPath(new URL("../docs/tutorial/index.html", import.meta.url));
const previewRoot = fileURLToPath(new URL("../artifacts/tutorial-preview/", import.meta.url));
const slideDir = publish
  ? fileURLToPath(new URL("../docs/assets/tutorial/slides/", import.meta.url))
  : `${previewRoot}/slides`;
const pdfPath = publish
  ? fileURLToPath(new URL("../docs/tutorial/robosats-visual-guide.pdf", import.meta.url))
  : `${previewRoot}/robosats-visual-guide-preview.pdf`;
const qaPath = `${previewRoot}/qa-report.json`;
const contactSheetPath = `${previewRoot}/${publish ? "published" : "preview"}-contact-sheet.png`;

await mkdir(slideDir, { recursive: true });
await mkdir(previewRoot, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--allow-file-access-from-files", "--disable-dev-shm-usage", "--disable-gpu"],
  headless: true
});

const report = {
  mode: publish ? "publish" : "preview",
  generatedAt: new Date().toISOString(),
  slideCount: 0,
  failures: [],
  slides: []
};

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${pathToFileURL(indexPath).href}?render=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__tutorialReady === true, null, { timeout: 30_000 });

  const secretMatches = await page.evaluate(() => {
    const patterns = [
      ["Fleet key", /rsgarage[0-9a-z]+/gi],
      ["Lightning invoice", /ln(?:bc|tb|bcrt)[0-9a-z]+/gi],
      ["Nostr private key", /nsec1[0-9a-z]+/gi],
      ["PGP private key", /BEGIN PGP PRIVATE KEY/gi]
    ];
    return patterns.flatMap(([label, pattern]) =>
      [...document.body.innerText.matchAll(pattern)].map((match) => ({
        label,
        sample: match[0].slice(0, 18)
      }))
    );
  });
  if (secretMatches.length > 0) report.failures.push({ type: "secret-text", matches: secretMatches });

  const slides = page.locator(".slide");
  report.slideCount = await slides.count();
  const slidePaths = [];

  for (let index = 0; index < report.slideCount; index += 1) {
    const slide = slides.nth(index);
    const title = (await slide.locator("h1, h2").first().innerText()).trim();
    const filename = `${String(index + 1).padStart(2, "0")}-${slug(title)}.png`;
    const path = `${slideDir}/${filename}`;
    const metrics = await slide.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const copy = element.querySelector(".slide-copy")?.getBoundingClientRect();
      const callout = element.querySelector(".guide-callout")?.getBoundingClientRect();
      const visual = element.querySelector(".slide-visual")?.getBoundingClientRect();
      const brokenImages = [...element.querySelectorAll("img")]
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.getAttribute("src"));
      return {
        brokenImages,
        copyCalloutOverlap: Boolean(
          copy &&
          callout &&
          copy.left < callout.right + 8 &&
          copy.right > callout.left - 8 &&
          copy.top < callout.bottom + 8 &&
          copy.bottom > callout.top - 8
        ),
        height: Math.round(bounds.height),
        horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
        verticalOverflow: element.scrollHeight > element.clientHeight + 1,
        visualClipped: Boolean(
          visual &&
          (visual.left < bounds.left - 1 ||
            visual.right > bounds.right + 1 ||
            visual.top < bounds.top - 1 ||
            visual.bottom > bounds.bottom + 1)
        ),
        width: Math.round(bounds.width)
      };
    });

    const failures = [];
    if (metrics.width !== 1600 || metrics.height !== 900) failures.push("wrong-dimensions");
    if (metrics.brokenImages.length > 0) failures.push("broken-images");
    if (metrics.horizontalOverflow || metrics.verticalOverflow) failures.push("slide-overflow");
    if (metrics.visualClipped) failures.push("visual-clipped");
    if (metrics.copyCalloutOverlap) failures.push("copy-callout-overlap");

    await slide.screenshot({ animations: "disabled", path });
    slidePaths.push(path);
    report.slides.push({ filename, title, metrics, failures });
    if (failures.length > 0) report.failures.push({ type: "slide", index: index + 1, title, failures });
  }

  await page.pdf({
    displayHeaderFooter: false,
    height: "900px",
    margin: { bottom: "0", left: "0", right: "0", top: "0" },
    path: pdfPath,
    preferCSSPageSize: true,
    printBackground: true,
    width: "1600px"
  });

  execFileSync("montage", [
    ...slidePaths,
    "-thumbnail",
    "320x180",
    "-tile",
    "5x",
    "-geometry",
    "+12+12",
    "-background",
    "#080708",
    contactSheetPath
  ]);

  await page.close();
} finally {
  await browser.close();
}

await writeFile(qaPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      contactSheetPath,
      failures: report.failures,
      mode: report.mode,
      pdfPath,
      qaPath,
      slideCount: report.slideCount,
      slideDir
    },
    null,
    2
  )
);

if (report.failures.length > 0) process.exitCode = 1;

function slug(value) {
  return (
    value
      .normalize("NFKD")
      .replaceAll(/[^a-zA-Z0-9]+/g, "-")
      .replaceAll(/(^-|-$)/g, "")
      .toLowerCase()
      .slice(0, 52) || "slide"
  );
}
