import { expect, it } from "vitest";
import { sanitizeChatImage } from "./chatImageSanitizer";

const text = (value: string) => new TextEncoder().encode(value);
const combine = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((part) => [...part]));
const marker = (tag: number, payload: Uint8Array) =>
  combine(new Uint8Array([255, tag, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload);
const tiff = new Uint8Array([
  73, 73, 42, 0, 8, 0, 0, 0, 2, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 37, 136, 4, 0, 1, 0, 0, 0, 38, 0, 0, 0, 0, 0, 0,
  0
]);
const exif = combine(tiff, text("synthetic-location"));
const orientation = new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);

function jpeg(...extra: Uint8Array[]) {
  return combine(
    new Uint8Array([255, 216]),
    ...extra,
    marker(0xc0, new Uint8Array([8, 0, 24, 0, 32, 1, 1, 0x11, 0])),
    marker(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])),
    new Uint8Array([32, 255, 0, 42, 255, 208, 32, 255, 217])
  );
}

it("removes JPEG EXIF/GPS, XMP, comments and trailing data, preserving orientation, color and scan bytes", () => {
  const icc = marker(0xe2, combine(text("ICC_PROFILE\0"), new Uint8Array([1, 1, 42])));
  const dirty = combine(
    jpeg(
      marker(0xe1, combine(text("Exif\0\0"), exif)),
      icc,
      marker(0xe1, text("synthetic-xmp")),
      marker(0xfe, text("synthetic-comment"))
    ),
    text("trailing")
  );
  const clean = sanitizeChatImage(dirty, "image/jpeg");
  expect(clean.bytes).toEqual(jpeg(marker(0xe1, combine(text("Exif\0\0"), orientation)), icc));
  expect([clean.width, clean.height]).toEqual([32, 24]);
});

it("reads big-endian orientation without retaining other EXIF fields", () => {
  const big = new Uint8Array([77, 77, 0, 42, 0, 0, 0, 8, 0, 1, 1, 18, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  expect(sanitizeChatImage(jpeg(marker(0xe1, combine(text("Exif\0\0"), big))), "image/jpeg").bytes).toEqual(
    jpeg(marker(0xe1, combine(text("Exif\0\0"), orientation)))
  );
});

function pngChunk(name: string, payload = new Uint8Array()) {
  const chunk = combine(new Uint8Array(4), text(name), payload, new Uint8Array(4));
  new DataView(chunk.buffer).setUint32(0, payload.length);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  new DataView(chunk.buffer).setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

function png(...extra: Uint8Array[]) {
  return combine(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", new Uint8Array([0, 0, 0, 32, 0, 0, 0, 24, 8, 6, 0, 0, 0])),
    ...extra,
    pngChunk("IDAT", new Uint8Array([1, 2, 3])),
    pngChunk("IEND")
  );
}

it("preserves screenshot pixel, alpha, color and animation chunks without descriptive PNG metadata", () => {
  const frames = [
    pngChunk("acTL", new Uint8Array(8)),
    pngChunk("fcTL", new Uint8Array(26)),
    pngChunk("fdAT", new Uint8Array(12))
  ];
  const color = pngChunk("iCCP", text("synthetic-profile"));
  const dirty = png(
    color,
    ...frames,
    pngChunk("eXIf", exif),
    pngChunk("tEXt", text("synthetic-location")),
    pngChunk("iTXt", text("synthetic-xmp")),
    pngChunk("zTXt", text("synthetic-comment"))
  );
  const clean = sanitizeChatImage(dirty, "image/png");
  expect(clean.bytes).toEqual(png(color, ...frames, pngChunk("eXIf", orientation)));
  expect([clean.width, clean.height]).toEqual([32, 24]);
});

function riffChunk(name: string, payload: Uint8Array) {
  const chunk = combine(text(name), new Uint8Array(4), payload, new Uint8Array(payload.length & 1));
  new DataView(chunk.buffer).setUint32(4, payload.length, true);
  return chunk;
}
function webp(...chunks: Uint8Array[]) {
  const result = combine(text("RIFF"), new Uint8Array(4), text("WEBP"), ...chunks);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}

it("cleans WebP metadata and its feature flags without touching compressed frames or looping", () => {
  const header = (flags: number) => riffChunk("VP8X", new Uint8Array([flags, 0, 0, 0, 31, 0, 0, 23, 0, 0]));
  const frames = [
    riffChunk("ANIM", new Uint8Array(6)),
    riffChunk("ANMF", new Uint8Array(16)),
    riffChunk("ICCP", text("synthetic-profile"))
  ];
  const dirty = webp(header(46), ...frames, riffChunk("EXIF", exif), riffChunk("XMP ", text("synthetic-location")));
  const clean = sanitizeChatImage(dirty, "image/webp");
  expect(clean.bytes).toEqual(webp(header(42), ...frames, riffChunk("EXIF", orientation)));
  expect([clean.width, clean.height]).toEqual([32, 24]);
  expect(sanitizeChatImage(webp(header(12), riffChunk("EXIF", text("malformed"))), "image/webp").bytes[20]).toBe(0);
});

it.each([
  ["VP8L", new Uint8Array([47, 0, 0, 0, 0])],
  ["VP8 ", new Uint8Array([0, 0, 0, 157, 1, 42, 1, 0, 1, 0])]
])("preserves a small simple %s WebP", (type, pixels) => {
  const bytes = webp(riffChunk(type, pixels));
  expect(sanitizeChatImage(bytes, "image/webp")).toEqual({ bytes, width: 1, height: 1 });
});

const gif = new Uint8Array(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
it("preserves GIF frames, timing, transparency and loop count, removing comments and application metadata", () => {
  const loop = combine(new Uint8Array([33, 255, 11]), text("NETSCAPE2.0"), new Uint8Array([3, 1, 0, 0, 0]));
  const comment = combine(new Uint8Array([33, 254, 18]), text("synthetic-location"), new Uint8Array([0]));
  const application = combine(new Uint8Array([33, 255, 11]), text("XMP DataXMP"), new Uint8Array([4, 1, 2, 3, 4, 0]));
  const clean = combine(gif.subarray(0, 19), loop, gif.subarray(19));
  const dirty = combine(gif.subarray(0, 19), comment, application, loop, gif.subarray(19), text("trailing"));
  expect(sanitizeChatImage(dirty, "image/gif").bytes).toEqual(clean);
});

it.each([
  ["image/jpeg", jpeg()],
  ["image/png", png()],
  ["image/webp", webp(riffChunk("VP8L", new Uint8Array([47, 0, 0, 0, 0])))],
  ["image/gif", gif]
])("rejects truncated %s without returning the uncleaned input", (type, bytes) => {
  expect(() => sanitizeChatImage(bytes.subarray(0, -1), type)).toThrow("could not be prepared");
  expect(() => sanitizeChatImage(new Uint8Array([1, 2, 3]), type)).toThrow();
});

it("bounds pixel allocation before decoding and rejects mismatched formats", () => {
  const huge = jpeg();
  const view = new DataView(huge.buffer);
  view.setUint16(7, 5000);
  view.setUint16(9, 5000);
  expect(() => sanitizeChatImage(huge, "image/jpeg")).toThrow("too large");
  view.setUint16(7, 1);
  view.setUint16(9, 20000);
  expect(() => sanitizeChatImage(huge, "image/jpeg")).toThrow("too large");
  expect(() => sanitizeChatImage(png(), "image/jpeg")).toThrow("could not be prepared");
  const oversizedFrame = gif.slice();
  oversizedFrame[32] = 255;
  expect(() => sanitizeChatImage(oversizedFrame, "image/gif")).toThrow();
});
