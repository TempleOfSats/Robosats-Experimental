import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppTransitionDialog, AppTransitionFeedback } from "@/components/app/AppTransitionFeedback";

describe("AppTransitionFeedback", () => {
  it("renders a polite loading status with the RoboSats mark", () => {
    const html = renderToStaticMarkup(
      <AppTransitionFeedback title="Preparing RoboSats" message="Loading the private interface..." />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("/static/assets/vector/R-notext.svg");
    expect(html).toContain("Preparing RoboSats");
    expect(html).toContain("Loading the private interface...");
  });

  it("renders blocking transitions as modal feedback", () => {
    const html = renderToStaticMarkup(
      <AppTransitionDialog title="Preparing Pro Fleet" message="Opening Fleet setup..." />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Preparing Pro Fleet"');
    expect(html).toContain("Opening Fleet setup...");
  });
});
