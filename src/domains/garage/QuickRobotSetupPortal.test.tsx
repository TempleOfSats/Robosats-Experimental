// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickRobotSetupPortal } from "@/domains/garage/QuickRobotSetupPortal";

vi.mock("@/domains/garage/QuickRobotSetup", () => new Promise(() => undefined));

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("QuickRobotSetupPortal", () => {
  it("can be closed while its lazy dialog is still loading", async () => {
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(<PortalHarness />);
    });

    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close robot setup"]');
    expect(close).not.toBeNull();

    await act(async () => close?.click());

    expect(document.body.textContent).not.toContain("Preparing robot setup");
  });
});

function PortalHarness() {
  const [open, setOpen] = useState(true);
  return <QuickRobotSetupPortal onClose={() => setOpen(false)} onComplete={() => undefined} open={open} />;
}
