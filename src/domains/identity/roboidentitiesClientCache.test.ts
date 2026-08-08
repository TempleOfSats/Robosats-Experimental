import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateBrowserRobohash: vi.fn(async (hashId: string) => `avatar:${hashId}`),
  generateBrowserRoboname: vi.fn((hashId: string) => `name:${hashId}`)
}));

vi.mock("@/domains/identity/roboidentitiesBrowser", () => mocks);

import { generateRobohash } from "@/domains/identity/roboidentitiesClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("robot identity avatar cache", () => {
  it("generates and caches one scalable avatar per robot", async () => {
    const hashId = "b".repeat(64);

    await expect(Promise.all([generateRobohash(hashId), generateRobohash(hashId)])).resolves.toEqual([
      `avatar:${hashId}`,
      `avatar:${hashId}`
    ]);
    await expect(generateRobohash(hashId)).resolves.toBe(`avatar:${hashId}`);

    expect(mocks.generateBrowserRobohash).toHaveBeenCalledOnce();
    expect(mocks.generateBrowserRobohash).toHaveBeenCalledWith(hashId);
  });

  it("migrates a previously cached sized avatar without regenerating it", async () => {
    const hashId = "c".repeat(64);
    const legacyKey = encodeURIComponent(`${hashId};large`);
    const legacyAvatar = "data:image/svg+xml;base64,PHN2Zy8+";
    vi.stubGlobal("caches", {
      open: vi.fn(async () => ({
        delete: vi.fn(async () => true),
        keys: vi.fn(async () => []),
        match: vi.fn(async (request: Request) =>
          request.url.endsWith(legacyKey) ? new Response(legacyAvatar) : undefined
        ),
        put: vi.fn(async () => undefined)
      }))
    });

    await expect(generateRobohash(hashId)).resolves.toBe(legacyAvatar);

    expect(mocks.generateBrowserRobohash).not.toHaveBeenCalledWith(hashId);
  });
});
