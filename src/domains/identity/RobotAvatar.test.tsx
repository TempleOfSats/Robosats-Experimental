// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateRobohash = vi.hoisted(() => vi.fn(async (hashId: string) => `avatar:${hashId}`));

vi.mock("@/domains/identity/roboavatarClient", () => ({ generateRobohash }));

import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { publishRefreshIntent } from "@/domains/transport/refreshIntents";

beforeEach(() => {
  generateRobohash.mockReset();
  generateRobohash.mockImplementation(async (hashId: string) => `avatar:${hashId}`);
});

afterEach(() => {
  document.body.innerHTML = "";
});

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

describe("RobotAvatar download recovery", () => {
  const hashId = "abcdef123456";

  it("retries a failed avatar on the next app intent and renders the art that arrives", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    generateRobohash.mockRejectedValueOnce(new Error("Identity assets returned 503"));
    const { container, root } = mount();

    await act(async () => {
      root.render(<RobotAvatar hashId={hashId} label="Test Robot" />);
    });

    expect(container.querySelector("img")).toBeNull();
    expect(avatarState(container)).toBeNull();

    await act(async () => {
      publishRefreshIntent("tor-reconnected");
    });
    await vi.waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe(`avatar:${hashId}`));

    expect(generateRobohash).toHaveBeenCalledTimes(2);
    expect(avatarState(container)).toBeNull();
    await act(async () => root.unmount());
  });

  it("claims one retry per intent while the asset server keeps failing", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    generateRobohash.mockRejectedValue(new Error("Identity assets returned 503"));
    const { container, root } = mount();

    await act(async () => {
      root.render(<RobotAvatar hashId={hashId} label="Test Robot" />);
    });

    for (const reason of ["online", "resume"] as const) {
      await act(async () => {
        publishRefreshIntent(reason);
      });
    }
    await vi.waitFor(() => expect(generateRobohash).toHaveBeenCalledTimes(3));

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".robot-avatar-placeholder")).not.toBeNull();
    expect(avatarState(container)).toBeNull();
    await act(async () => root.unmount());
  });

  it("does not refetch an avatar that already rendered", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { container, root } = mount();

    await act(async () => {
      root.render(<RobotAvatar hashId={hashId} />);
    });
    await vi.waitFor(() => expect(container.querySelector("img")).not.toBeNull());

    for (const reason of ["focus", "online", "resume"] as const) {
      await act(async () => {
        publishRefreshIntent(reason);
      });
    }

    expect(generateRobohash).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("keeps the newest robot when an older download finishes last", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let finishOldest: ((value: string) => void) | undefined;
    generateRobohash.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOldest = resolve;
        })
    );
    const { container, root } = mount();

    await act(async () => {
      root.render(<RobotAvatar hashId={"f".repeat(12)} />);
    });
    await act(async () => {
      root.render(<RobotAvatar hashId={"a".repeat(12)} />);
    });
    await vi.waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toBe(`avatar:${"a".repeat(12)}`)
    );

    await act(async () => {
      finishOldest!(`avatar:${"f".repeat(12)}`);
      await Promise.resolve();
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(`avatar:${"a".repeat(12)}`);
    await act(async () => root.unmount());
  });
});

function mount(): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  document.body.append(container);
  return { container, root: createRoot(container) };
}

function avatarState(container: HTMLElement): string | null {
  return container.querySelector(".robot-avatar")?.getAttribute("aria-busy") ?? null;
}
