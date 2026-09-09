import { CHAT_IMAGE_TYPES, MAX_CHAT_IMAGE_BYTES } from "@/domains/chat/chatImageMetadata";
import { sanitizeChatImage } from "@/domains/chat/chatImageSanitizer";

export async function prepareChatImage(file: File, signal: AbortSignal): Promise<File> {
  signal.throwIfAborted();
  if (!CHAT_IMAGE_TYPES.includes(file.type)) throw new Error("Choose a JPEG, PNG, WebP or GIF image.");
  if (!file.size || file.size > MAX_CHAT_IMAGE_BYTES) throw new Error("Choose an image smaller than 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const clean = sanitizeChatImage(bytes, file.type);
  const original = new Blob([clean.bytes], { type: file.type });
  // Screenshots and animations keep their pixels. Only large JPEG photos are re-encoded.
  const optimized =
    file.type === "image/jpeg" && original.size > 256 * 1024 ? await compressPhoto(original, signal) : undefined;
  signal.throwIfAborted();
  const selected = optimized && optimized.size < original.size * 0.95 ? optimized : original;
  return new File([selected], "image", { type: selected.type, lastModified: 0 });
}

async function compressPhoto(original: Blob, signal: AbortSignal): Promise<Blob | undefined> {
  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (typeof createImageBitmap !== "function") return undefined;
    bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
    signal.throwIfAborted();
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encoded = await new Promise<Blob | null>((resolve) => canvas!.toBlob(resolve, "image/jpeg", 0.9));
    signal.throwIfAborted();
    return encoded?.type === "image/jpeg" && encoded.size ? encoded : undefined;
  } catch {
    signal.throwIfAborted();
    // Canvas restrictions or encoder failures must never fall back to unsanitized bytes.
    return undefined;
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
