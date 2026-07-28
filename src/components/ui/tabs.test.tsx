import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { nextTabValue, tabId, Tabs } from "@/components/ui/tabs";

describe("Tabs", () => {
  it("connects one selected tab to its panel with roving focus", () => {
    const html = renderToStaticMarkup(
      <Tabs
        ariaLabel="Example view"
        id="example"
        onChange={() => undefined}
        options={[
          { value: "first", label: "First" },
          { value: "second", label: "Second" }
        ]}
        panelId="example-panel"
        value="second"
      />
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-controls="example-panel"');
    expect(html).toContain('id="example-tab-second"');
    expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"/);
    expect(html).toMatch(/aria-selected="false"[^>]*tabindex="-1"/);
  });

  it("wraps arrow navigation and supports Home and End", () => {
    const values = ["one", "two", "three"] as const;
    expect(nextTabValue([...values], "one", "ArrowLeft")).toBe("three");
    expect(nextTabValue([...values], "three", "ArrowRight")).toBe("one");
    expect(nextTabValue([...values], "two", "Home")).toBe("one");
    expect(nextTabValue([...values], "two", "End")).toBe("three");
    expect(tabId("test", "two words")).toBe("test-tab-two-words");
  });
});
