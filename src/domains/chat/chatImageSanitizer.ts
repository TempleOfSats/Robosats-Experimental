type CleanImage = { bytes: Uint8Array<ArrayBuffer>; width: number; height: number };

const invalid = () => new Error("This image could not be prepared. Choose another image.");
const ascii = (bytes: Uint8Array, start: number, count: number) =>
  String.fromCharCode(...bytes.subarray(start, start + count));
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function sanitizeChatImage(bytes: Uint8Array<ArrayBuffer>, type: string): CleanImage {
  const result =
    type === "image/jpeg"
      ? cleanJpeg(bytes)
      : type === "image/png"
        ? cleanPng(bytes)
        : type === "image/webp"
          ? cleanWebp(bytes)
          : type === "image/gif"
            ? cleanGif(bytes)
            : undefined;
  if (!result || !result.width || !result.height) throw invalid();
  if (result.width * result.height > 24_000_000 || Math.max(result.width, result.height) > 16_384) {
    throw new Error("This image is too large to prepare safely. Choose a smaller image.");
  }
  return result;
}

function join(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function orientationOnly(bytes: Uint8Array): Uint8Array | undefined {
  const tiff = ascii(bytes, 0, 6) === "Exif\0\0" ? bytes.subarray(6) : bytes;
  if (tiff.length < 8) return undefined;
  const little = ascii(tiff, 0, 2) === "II";
  if (!little && ascii(tiff, 0, 2) !== "MM") return undefined;
  const view = viewOf(tiff);
  if (view.getUint16(2, little) !== 42) return undefined;
  const start = view.getUint32(4, little);
  if (start < 8 || start + 2 > tiff.length) return undefined;
  const count = view.getUint16(start, little);
  if (start + 2 + count * 12 + 4 > tiff.length) return undefined;
  for (let i = 0; i < count; i++) {
    const offset = start + 2 + i * 12;
    if (
      view.getUint16(offset, little) !== 0x112 ||
      view.getUint16(offset + 2, little) !== 3 ||
      view.getUint32(offset + 4, little) !== 1
    )
      continue;
    const orientation = view.getUint16(offset + 8, little);
    if (orientation < 2 || orientation > 8) return undefined;
    return new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]);
  }
  return undefined;
}

function cleanJpeg(bytes: Uint8Array): CleanImage {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw invalid();
  const parts = [bytes.subarray(0, 2)];
  let cursor = 2,
    width = 0,
    height = 0;
  while (cursor < bytes.length) {
    const start = cursor;
    if (bytes[cursor++] !== 0xff) throw invalid();
    while (bytes[cursor] === 0xff) cursor++;
    const marker = bytes[cursor++];
    if (marker === 0xd9) {
      parts.push(new Uint8Array([0xff, 0xd9]));
      return { bytes: join(parts), width, height };
    }
    if (cursor + 2 > bytes.length) throw invalid();
    const size = viewOf(bytes).getUint16(cursor);
    const end = cursor + size;
    if (size < 2 || end > bytes.length) throw invalid();
    const payload = bytes.subarray(cursor + 2, end);
    const frame = [0xc0, 0xc1, 0xc2].includes(marker);
    if (frame) {
      if (payload.length < 6 || width || height) throw invalid();
      height = viewOf(payload).getUint16(1);
      width = viewOf(payload).getUint16(3);
    }
    const part = cleanJpegSegment(marker, bytes.subarray(start, end), payload);
    if (part) parts.push(part);
    cursor = end;
    if (marker === 0xda) {
      cursor = jpegScanEnd(bytes, cursor);
      parts.push(bytes.subarray(end, cursor));
    }
  }
  throw invalid();
}

function cleanJpegSegment(marker: number, segment: Uint8Array, payload: Uint8Array): Uint8Array | undefined {
  if (marker === 0xe1 && ascii(payload, 0, 6) === "Exif\0\0") {
    const orientation = orientationOnly(payload);
    return orientation ? join([new Uint8Array([255, 225, 0, 34, 69, 120, 105, 102, 0, 0]), orientation]) : undefined;
  }
  if (marker === 0xe2 && ascii(payload, 0, 12) === "ICC_PROFILE\0") return segment;
  if (marker === 0xee && payload.length === 12 && ascii(payload, 0, 5) === "Adobe") return segment;
  if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) return undefined;
  return segment;
}

function jpegScanEnd(bytes: Uint8Array, offset: number): number {
  let cursor = offset;
  while (cursor < bytes.length) {
    const marker = bytes.indexOf(0xff, cursor);
    if (marker < 0) throw invalid();
    cursor = marker + 1;
    while (bytes[cursor] === 0xff) cursor++;
    const code = bytes[cursor++];
    if (code === 0 || (code >= 0xd0 && code <= 0xd7)) continue;
    return marker;
  }
  throw invalid();
}

const pngChunks = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "sBIT",
  "pHYs",
  "acTL",
  "fcTL",
  "fdAT",
  "cICP",
  "mDCV",
  "cLLI"
]);

function cleanPng(bytes: Uint8Array): CleanImage {
  if (ascii(bytes, 0, 8) !== "\x89PNG\r\n\x1a\n") throw invalid();
  const parts = [bytes.subarray(0, 8)];
  let width = 0,
    height = 0;
  for (let cursor = 8; cursor + 12 <= bytes.length;) {
    const length = viewOf(bytes).getUint32(cursor);
    const end = cursor + 12 + length;
    if (end > bytes.length) throw invalid();
    const type = ascii(bytes, cursor + 4, 4);
    if (cursor === 8 && (type !== "IHDR" || length !== 13)) throw invalid();
    if (type === "IHDR") {
      if (cursor !== 8) throw invalid();
      width = viewOf(bytes).getUint32(cursor + 8);
      height = viewOf(bytes).getUint32(cursor + 12);
    }
    if (type === "eXIf") {
      const orientation = orientationOnly(bytes.subarray(cursor + 8, end - 4));
      if (orientation) parts.push(pngOrientation(orientation));
    } else if (pngChunks.has(type)) parts.push(bytes.subarray(cursor, end));
    if (type === "IEND") return { bytes: join(parts), width, height };
    cursor = end;
  }
  throw invalid();
}

function pngOrientation(tiff: Uint8Array): Uint8Array {
  const chunk = join([new Uint8Array([0, 0, 0, tiff.length, 101, 88, 73, 102]), tiff, new Uint8Array(4)]);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  viewOf(chunk).setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

const webpChunks = new Set(["VP8X", "VP8 ", "VP8L", "ALPH", "ICCP", "ANIM", "ANMF"]);

function cleanWebp(bytes: Uint8Array): CleanImage {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") throw invalid();
  const limit = viewOf(bytes).getUint32(4, true) + 8;
  if (limit > bytes.length) throw invalid();
  const parts = [bytes.slice(0, 12)];
  let width = 0,
    height = 0;
  let extended: Uint8Array | undefined,
    hasOrientation = false;
  for (let cursor = 12; cursor < limit;) {
    if (cursor + 8 > limit) throw invalid();
    const length = viewOf(bytes).getUint32(cursor + 4, true);
    const end = cursor + 8 + length + (length & 1);
    if (end > limit) throw invalid();
    const type = ascii(bytes, cursor, 4);
    const part = bytes.slice(cursor, end);
    if (type === "VP8X") {
      if (length !== 10 || extended) throw invalid();
      extended = part;
      width = 1 + (viewOf(part).getUint32(12, true) & 0xffffff);
      height = 1 + (part[15] | (part[16] << 8) | (part[17] << 16));
    } else if (!extended && (type === "VP8 " || type === "VP8L")) {
      [width, height] = webpDimensions(type, part.subarray(8, 8 + length));
    }
    if (type === "EXIF") {
      const orientation = orientationOnly(part.subarray(8, 8 + length));
      if (orientation) {
        parts.push(join([new Uint8Array([69, 88, 73, 70, 26, 0, 0, 0]), orientation]));
        hasOrientation = true;
      }
    } else if (webpChunks.has(type)) parts.push(part);
    cursor = end;
  }
  if (extended) extended[8] = (extended[8] & ~12) | (hasOrientation ? 8 : 0);
  const result = join(parts);
  viewOf(result).setUint32(4, result.length - 8, true);
  return { bytes: result, width, height };
}

function webpDimensions(type: string, bytes: Uint8Array): [number, number] {
  if (type === "VP8L" && bytes.length >= 5 && bytes[0] === 0x2f) {
    const packed = viewOf(bytes).getUint32(1, true);
    return [(packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1];
  }
  if (type === "VP8 " && bytes.length >= 10 && ascii(bytes, 3, 3) === "\x9d\x01\x2a") {
    return [viewOf(bytes).getUint16(6, true) & 0x3fff, viewOf(bytes).getUint16(8, true) & 0x3fff];
  }
  throw invalid();
}

function cleanGif(bytes: Uint8Array): CleanImage {
  if (!["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)) || bytes.length < 13) throw invalid();
  const width = viewOf(bytes).getUint16(6, true),
    height = viewOf(bytes).getUint16(8, true);
  let cursor = 13 + gifPaletteSize(bytes[10]);
  const parts = [bytes.subarray(0, cursor)];
  while (cursor < bytes.length) {
    const start = cursor;
    const type = bytes[cursor++];
    if (type === 0x3b) {
      parts.push(bytes.subarray(start, cursor));
      return { bytes: join(parts), width, height };
    }
    if (type === 0x2c) {
      if (cursor + 9 > bytes.length) throw invalid();
      const frame = viewOf(bytes.subarray(cursor));
      if (
        frame.getUint16(0, true) + frame.getUint16(4, true) > width ||
        frame.getUint16(2, true) + frame.getUint16(6, true) > height
      )
        throw invalid();
      cursor += 9 + gifPaletteSize(bytes[cursor + 8]);
      cursor = gifBlockEnd(bytes, cursor + 1);
      parts.push(bytes.subarray(start, cursor));
    } else if (type === 0x21) {
      const label = bytes[cursor++];
      const loop =
        label === 0xff && bytes[cursor] === 11 && ["NETSCAPE2.0", "ANIMEXTS1.0"].includes(ascii(bytes, cursor + 1, 11));
      cursor = gifBlockEnd(bytes, cursor);
      if ((label === 0xf9 && cursor - start === 8) || (loop && cursor - start === 19))
        parts.push(bytes.subarray(start, cursor));
    } else throw invalid();
  }
  throw invalid();
}

function gifPaletteSize(packed: number): number {
  return packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0;
}

function gifBlockEnd(bytes: Uint8Array, offset: number): number {
  while (offset < bytes.length) {
    const size = bytes[offset++];
    if (!size) return offset;
    offset += size;
  }
  throw invalid();
}
