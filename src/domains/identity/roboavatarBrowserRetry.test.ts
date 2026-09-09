import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("avatar asset recovery", () => {
  it("downloads the asset pack once for avatars generated together", async () => {
    const { generateBrowserRobohash } = await freshBrowser();
    const fetchPack = vi.fn(async () => new Response(identityAssetPack()));
    vi.stubGlobal("fetch", fetchPack);

    await Promise.all([generateBrowserRobohash("a".repeat(64)), generateBrowserRobohash("b".repeat(64))]);

    expect(fetchPack).toHaveBeenCalledOnce();
  });

  it("fetches the asset pack again after an unreachable asset server", async () => {
    const { generateBrowserRobohash } = await freshBrowser();
    const fetchPack = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(new Response(identityAssetPack()));
    vi.stubGlobal("fetch", fetchPack);

    await expect(generateBrowserRobohash("a".repeat(64))).rejects.toThrow("Failed to fetch");
    const avatar = await generateBrowserRobohash("a".repeat(64));

    expect(fetchPack).toHaveBeenCalledTimes(2);
    expect(avatar).toContain("data:image/svg+xml;base64,");
  });

  it("re-reads pack and layers after an error response or a dropped body", async () => {
    const { generateBrowserRobohash } = await freshBrowser();
    const fetchPack = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(responseWithFailingBody())
      .mockResolvedValue(new Response(identityAssetPack()));
    vi.stubGlobal("fetch", fetchPack);

    await expect(generateBrowserRobohash("a".repeat(64))).rejects.toThrow("Identity assets returned 503");
    await expect(generateBrowserRobohash("a".repeat(64))).rejects.toThrow("Connection reset");
    const avatar = await generateBrowserRobohash("a".repeat(64));

    expect(fetchPack).toHaveBeenCalledTimes(3);
    expect(avatar).toContain("data:image/svg+xml;base64,");
  });

  it("fetches the asset pack again after an invalid pack header", async () => {
    const { generateBrowserRobohash } = await freshBrowser();
    const fetchPack = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(new TextEncoder().encode("NOTA PACK")))
      .mockResolvedValue(new Response(identityAssetPack()));
    vi.stubGlobal("fetch", fetchPack);

    await expect(generateBrowserRobohash("a".repeat(64))).rejects.toThrow("Identity asset pack is invalid");
    const avatar = await generateBrowserRobohash("a".repeat(64));

    expect(fetchPack).toHaveBeenCalledTimes(2);
    expect(avatar).toContain("data:image/svg+xml;base64,");
  });
});

// A pack that succeeded once is cached for the session, so each case needs its own
// module instance to observe a download failure instead of a warm cache.
async function freshBrowser(): Promise<typeof import("@/domains/identity/roboavatarBrowser")> {
  vi.resetModules();
  return import("@/domains/identity/roboavatarBrowser");
}

function responseWithFailingBody(): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => {
      throw new TypeError("Connection reset");
    }
  } as unknown as Response;
}

function identityAssetPack(): ArrayBuffer {
  const count = 77;
  const dataOffset = 12 + count * 8;
  const pack = new ArrayBuffer(dataOffset + 1);
  const bytes = new Uint8Array(pack);
  bytes.set(new TextEncoder().encode("RSIDPK01"));
  const view = new DataView(pack);
  view.setUint16(8, count, true);
  for (let index = 0; index < count; index += 1) {
    view.setUint32(12 + index * 8, dataOffset, true);
    view.setUint32(16 + index * 8, 1, true);
  }
  return pack;
}
