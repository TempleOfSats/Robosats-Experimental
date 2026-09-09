// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareChatImage } from "./prepareChatImage";

const signal = () => new AbortController().signal;
const close = vi.fn();
const drawImage = vi.fn();
let canvas: HTMLCanvasElement;
let encoded: Blob | null;
let encodingSize: number[];
const photo = () => {
  const header = new Uint8Array([
    255, 216, 255, 254, 0, 9, 112, 114, 105, 118, 97, 116, 101, 255, 192, 0, 11, 8, 11, 184, 15, 160, 1, 1, 17, 0, 255,
    218, 0, 8, 1, 1, 0, 0, 63, 0
  ]);
  return new File([header, new Uint8Array(300_000), new Uint8Array([255, 217])], "camera.jpg", { type: "image/jpeg" });
};

beforeEach(() => {
  close.mockClear();
  drawImage.mockClear();
  encoded = new Blob([new Uint8Array(80_000)], { type: "image/jpeg" });
  encodingSize = [];
  canvas = document.createElement("canvas");
  vi.spyOn(document, "createElement").mockReturnValue(canvas);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 4000, height: 3000, close }))
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
    encodingSize = [this.width, this.height];
    callback(encoded);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("compresses a large photo once at high quality, bounds its edge and releases graphics resources", async () => {
  const result = await prepareChatImage(photo(), signal());
  expect(result.size).toBe(80_000);
  expect(result.type).toBe("image/jpeg");
  expect(result.name).toBe("image");
  expect(encodingSize).toEqual([2560, 1920]);
  expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.9);
  expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: "from-image" });
  expect(close).toHaveBeenCalledOnce();
  expect([canvas.width, canvas.height]).toEqual([0, 0]);
});

it("honors oriented dimensions and never upscales a small image", async () => {
  vi.mocked(createImageBitmap).mockResolvedValue({ width: 600, height: 800, close } as ImageBitmap);
  await prepareChatImage(photo(), signal());
  expect(encodingSize).toEqual([600, 800]);
});

it.each([
  null,
  new Blob([new Uint8Array(400_000)], { type: "image/jpeg" }),
  new Blob(["png-fallback"], { type: "image/png" }),
  new Blob([], { type: "image/jpeg" })
])("uses the metadata-cleaned original when an encoder result is unusable or larger", async (output) => {
  encoded = output;
  const file = photo();
  const result = await prepareChatImage(file, signal());
  expect(result.size).toBe(file.size - 11);
  expect(await result.text()).not.toContain("private");
  expect(close).toHaveBeenCalledOnce();
});

it("still strips metadata when canvas access is restricted", async () => {
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(() => {
    throw new Error("canvas blocked");
  });
  const result = await prepareChatImage(photo(), signal());
  expect(await result.text()).not.toContain("private");
  expect(close).toHaveBeenCalledOnce();
});

it("still strips metadata when image bitmap decoding is unavailable", async () => {
  vi.stubGlobal("createImageBitmap", undefined);
  const result = await prepareChatImage(photo(), signal());
  expect(await result.text()).not.toContain("private");
  expect(drawImage).not.toHaveBeenCalled();
});

it("preserves tiny images and animations without canvas work", async () => {
  const bytes = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (char) =>
    char.charCodeAt(0)
  );
  const result = await prepareChatImage(new File([bytes], "animation.gif", { type: "image/gif" }), signal());
  expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
  expect(createImageBitmap).not.toHaveBeenCalled();
});

it("rejects a canceled selection before reading or decoding it", async () => {
  const controller = new AbortController();
  controller.abort();
  const file = photo();
  const read = vi.spyOn(file, "arrayBuffer");
  await expect(prepareChatImage(file, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(read).not.toHaveBeenCalled();
  expect(createImageBitmap).not.toHaveBeenCalled();
});

it("releases a late bitmap and does not encode after cancellation", async () => {
  const controller = new AbortController();
  vi.mocked(createImageBitmap).mockImplementation(async () => {
    controller.abort();
    return { width: 4000, height: 3000, close } as ImageBitmap;
  });
  await expect(prepareChatImage(photo(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(close).toHaveBeenCalledOnce();
  expect(drawImage).not.toHaveBeenCalled();
});

it("discards a canvas result after cancellation instead of returning the original", async () => {
  const controller = new AbortController();
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => {
    controller.abort();
    callback(encoded);
  });
  await expect(prepareChatImage(photo(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(close).toHaveBeenCalledOnce();
  expect([canvas.width, canvas.height]).toEqual([0, 0]);
});

it("rejects empty, oversized, and non-image files before browser decoding", async () => {
  for (const file of [
    new File([], "empty.png", { type: "image/png" }),
    new File(["svg"], "vector.svg", { type: "image/svg+xml" }),
    new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" })
  ]) {
    await expect(prepareChatImage(file, signal())).rejects.toThrow("Choose");
  }
  expect(createImageBitmap).not.toHaveBeenCalled();
});
