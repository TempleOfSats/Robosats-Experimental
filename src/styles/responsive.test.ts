import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutCss = readFileSync(new URL("./layout.css", import.meta.url), "utf8");
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
});
