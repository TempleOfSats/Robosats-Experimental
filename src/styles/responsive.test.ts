import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutCss = readFileSync(new URL("./layout.css", import.meta.url), "utf8");
const coordinatorCss = readFileSync(new URL("./coordinatorGarage.css", import.meta.url), "utf8");
const orderbookCss = readFileSync(new URL("./orderbook.css", import.meta.url), "utf8");
const responsiveCss = readFileSync(new URL("./responsive.css", import.meta.url), "utf8");

function ruleBody(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

function atRuleBody(css: string, condition: string) {
  const start = css.indexOf(condition);
  if (start < 0) return "";
  const openingBrace = css.indexOf("{", start + condition.length);
  if (openingBrace < 0) return "";

  let depth = 1;
  for (let index = openingBrace + 1; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(openingBrace + 1, index);
  }
  return "";
}

describe("compact desktop navigation", () => {
  it("releases the sidebar from the titlebar offset only through 900px", () => {
    const compactCss = atRuleBody(responsiveCss, "@media (max-width: 900px)");
    const compactDesktopSidebar = ruleBody(compactCss, ".app-runtime-desktop .app-sidebar");
    const wideDesktopSidebar = ruleBody(layoutCss, ".app-runtime-desktop .app-sidebar");

    expect(compactDesktopSidebar).toMatch(/\bmin-height:\s*auto;/);
    expect(compactDesktopSidebar).toMatch(/\btop:\s*auto;/);
    expect(wideDesktopSidebar).toMatch(/\btop:\s*var\(--desktop-titlebar-height\);/);
    expect(wideDesktopSidebar).not.toMatch(/\btop:\s*auto;/);
  });

  it("uses only a restrained top indicator for the active mobile destination", () => {
    const compactCss = atRuleBody(responsiveCss, "@media (max-width: 900px)");
    const activeItem = ruleBody(compactCss, ".nav-item.active");
    const activeIndicator = ruleBody(compactCss, ".nav-item.active::before");
    const compactLightCss = atRuleBody(coordinatorCss, "@media (max-width: 900px)");
    const lightActiveItem = ruleBody(compactLightCss, ':root[data-theme="light"] .nav-item.active');

    expect(activeItem).toMatch(/\bbackground:\s*transparent;/);
    expect(activeItem).toMatch(/\bbox-shadow:\s*none;/);
    expect(activeIndicator).toMatch(/\bheight:\s*2px;/);
    expect(activeIndicator).toMatch(/\bbackground:\s*var\(--selection-indicator\);/);
    expect(lightActiveItem).toMatch(/\bbackground:\s*transparent;/);
  });

  it("keeps both Garage trade actions visible on exceptionally narrow screens", () => {
    const narrowCss = atRuleBody(responsiveCss, "@media (max-width: 340px)");
    const actionGrid = ruleBody(narrowCss, ".garage-profile-stage > .next-action-grid");
    const shortCss = atRuleBody(responsiveCss, "@media (max-width: 520px) and (max-height: 700px)");
    const shortStage = ruleBody(shortCss, ".garage-profile-stage");
    const shortAction = ruleBody(shortCss, ".garage-profile-stage .action-tile");

    expect(actionGrid).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    expect(shortStage).toMatch(/padding-block:\s*0 0\.75rem;/);
    expect(shortAction).toMatch(/min-height:\s*5rem;/);
  });
});

describe("compact orderbook filters", () => {
  it("keeps all three filter fields in one row through 600px", () => {
    const compactCss = atRuleBody(orderbookCss, "@media (max-width: 600px)");
    const filters = ruleBody(compactCss, ".orderbook-table-card .orderbook-secondary-filters");
    const wideFilter = ruleBody(
      compactCss,
      ".orderbook-table-card .orderbook-secondary-filters .filter-select-field-wide"
    );

    expect(filters).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
    expect(wideFilter).toMatch(/grid-column:\s*auto;/);
  });

  it("keeps mobile sort controls visibly bounded", () => {
    const compactCss = atRuleBody(responsiveCss, "@media (max-width: 900px)");
    const sortButton = ruleBody(compactCss, ".offer-mobile-sort-button");
    const activeSortButton = ruleBody(compactCss, ".offer-mobile-sort-button-active");

    expect(sortButton).toMatch(/border:\s*1px solid var\(--control-border\);/);
    expect(activeSortButton).toMatch(/border-color:\s*var\(--control-selected-indicator\);/);
  });
});
