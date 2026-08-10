// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualSelect, visualSelectMenuLayout } from "@/components/ui/visualSelect";

const playHaptic = vi.hoisted(() => vi.fn());
vi.mock("@/lib/haptics", () => ({ playHaptic }));

let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  playHaptic.mockReset();
  document.body.innerHTML = "";
});

describe("visualSelectMenuLayout", () => {
  it("opens above when the lower viewport is obstructed", () => {
    expect(
      visualSelectMenuLayout({
        anchorBottom: 592,
        anchorTop: 522,
        menuHeight: 303,
        viewportBottom: 745
      })
    ).toEqual({ maxHeight: 320, placement: "above" });
  });

  it("keeps the menu below when its content fits", () => {
    expect(
      visualSelectMenuLayout({
        anchorBottom: 170,
        anchorTop: 100,
        menuHeight: 180,
        viewportBottom: 745
      })
    ).toEqual({ maxHeight: 320, placement: "below" });
  });

  it("caps a long menu to the available side for scrolling", () => {
    expect(
      visualSelectMenuLayout({
        anchorBottom: 470,
        anchorTop: 400,
        menuHeight: 600,
        viewportBottom: 745
      })
    ).toEqual({ maxHeight: 320, placement: "above" });
  });

  it("uses one selection haptic only when the selected value changes", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    const onChange = vi.fn();
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <VisualSelect
          ariaLabel="Choose coordinator"
          onChange={onChange}
          options={[
            { label: "Temple", value: "temple" },
            { label: "Lake", value: "lake" }
          ]}
          value="temple"
        />
      );
    });

    await clickButton("Choose coordinator");
    await clickButton("Temple");
    expect(playHaptic).not.toHaveBeenCalled();

    await clickButton("Choose coordinator");
    await clickButton("Lake");
    expect(playHaptic).toHaveBeenCalledExactlyOnceWith("selection");
    expect(onChange).toHaveBeenLastCalledWith("lake");
  });
});

async function clickButton(label: string): Promise<void> {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}
