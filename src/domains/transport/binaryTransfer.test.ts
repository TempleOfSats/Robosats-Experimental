import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base64 } from "@scure/base";
import { transferBinary, MAX_BINARY_BYTES } from "./binaryTransfer";
import { coordinatorRequestScheduler } from "./requestScheduler";
import { resetTransportHealthForTests } from "./transportHealth";

const { native, isNative } = vi.hoisted(() => ({ native: vi.fn(), isNative: vi.fn(() => false) }));
vi.mock("./androidBridge", () => ({
  isNativeApp: isNative,
  isAndroidApp: isNative,
  isIOSApp: () => false,
  nativeHttpRequest: native,
  transportRequest: vi.fn()
}));

beforeEach(() => {
  coordinatorRequestScheduler.resetForTests();
  resetTransportHealthForTests();
  isNative.mockReturnValue(false);
  native.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("bounded binary transport", () => {
  it("preserves non-UTF8 bytes in browser PUT and GET and forbids redirects or credentials", async () => {
    const bytes = new Uint8Array([0, 255, 128, 13, 10]);
    const fetcher = vi.fn(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    const result = await transferBinary("https://coordinator.test", "/blossom/upload", new AbortController().signal, {
      bytes,
      authorization: "Nostr synthetic"
    });
    expect(result).toEqual(bytes);
    const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Uint8Array(options[1].body as ArrayBuffer)).toEqual(bytes);
    expect(options[1]).toMatchObject({
      method: "PUT",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer"
    });
  });

  it("uses the binary native bridge rather than web fetch", async () => {
    isNative.mockReturnValue(true);
    const bytes = new Uint8Array([255, 0, 128]);
    native.mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json" },
      body: base64.encode(bytes)
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      transferBinary("http://coordinator.test", "/blossom/test", new AbortController().signal)
    ).resolves.toEqual(bytes);
    expect(native.mock.calls[0]?.[4]).toBe(true);
    await transferBinary("http://coordinator.test", "/blossom/upload", new AbortController().signal, {
      bytes,
      authorization: "Nostr synthetic"
    });
    expect(native.mock.calls[1]?.[1]).toMatchObject({ method: "PUT", body: base64.encode(bytes) });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not trip coordinator connectivity recovery for oversized image responses", async () => {
    const failure = vi.spyOn(coordinatorRequestScheduler, "noteOriginFailure");
    const fetcher = vi.fn(
      async () => new Response("", { headers: { "Content-Length": String(MAX_BINARY_BYTES + 1) } })
    );
    vi.stubGlobal("fetch", fetcher);
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(
        transferBinary("https://coordinator.test", "/blossom/test", new AbortController().signal)
      ).rejects.toThrow("too large");
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(failure).not.toHaveBeenCalled();
    failure.mockRestore();
  });

  it("bounds streamed responses even without a content-length", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(MAX_BINARY_BYTES));
                controller.enqueue(new Uint8Array(1));
              },
              cancel
            })
          )
      )
    );
    await expect(
      transferBinary("https://coordinator.test", "/blossom/test", new AbortController().signal)
    ).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects oversized declared bodies without reading them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { headers: { "Content-Length": String(MAX_BINARY_BYTES + 1) } }))
    );
    await expect(
      transferBinary("https://coordinator.test", "/blossom/test", new AbortController().signal)
    ).rejects.toThrow("too large");
  });

  it("does not start cancelled work and does not retry a failed upload automatically", async () => {
    const fetcher = vi.fn(async () => new Response("unsupported", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(transferBinary("https://coordinator.test", "/blossom/test", controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      transferBinary("https://coordinator.test", "/blossom/upload", new AbortController().signal, {
        bytes: new Uint8Array(1),
        authorization: "Nostr synthetic"
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
