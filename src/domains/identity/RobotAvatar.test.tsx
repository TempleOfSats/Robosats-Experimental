// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const generateRobohash = vi.hoisted(() => vi.fn(async (hashId: string) => `avatar:${hashId}`));

vi.mock("@/domains/identity/roboidentitiesClient", () => ({ generateRobohash }));

import { RobotAvatar } from "@/domains/identity/RobotAvatar";

describe("RobotAvatar", () => {
  it("uses the shared robot icon while the generated avatar is loading", () => {
    const html = renderToStaticMarkup(<RobotAvatar hashId="abcdef123456" label="Test Robot" />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('stroke-width="1.8"');
    expect(html).toContain('d="M20 9V7a2 2 0 0 0-2-2h-3a3 3 0 0 0-6 0H6');
    expect(html).toContain('d="M8 17h8"');
  });

  it("reuses the generated avatar when only its display size changes", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);
    const hashId = "abcdef123456";

    await act(async () => {
      root.render(<RobotAvatar hashId={hashId} size="sm" />);
    });
    await vi.waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe(`avatar:${hashId}`));

    await act(async () => {
      root.render(<RobotAvatar hashId={hashId} size="xl" />);
    });

    expect(generateRobohash).toHaveBeenCalledOnce();
    expect(container.querySelector(".robot-avatar-xl img")).not.toBeNull();

    await act(async () => root.unmount());
  });
});
