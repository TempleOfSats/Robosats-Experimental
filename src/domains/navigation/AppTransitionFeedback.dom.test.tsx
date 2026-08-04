// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppTransitionDialog } from "@/domains/navigation/AppTransitionFeedback";

let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("AppTransitionDialog dismissal", () => {
  it("closes dismissible transitions while blocking transitions ignore Escape", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.querySelector("#root")!);
    const onClose = vi.fn();

    await act(async () => {
      root?.render(<AppTransitionDialog message="Loading..." onClose={onClose} title="Preparing trade finder" />);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Close preparing trade finder"]')?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);

    await act(async () => {
      root?.render(<AppTransitionDialog message="Loading..." title="Blocking transition" />);
    });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
