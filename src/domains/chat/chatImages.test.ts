import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base64 } from "@scure/base";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "js-sha256";
import { verifyEvent } from "nostr-tools/pure";
import { uploadChatImage, downloadChatImage } from "./chatImages";
import { parseChatImage, isChatImageMessage, MAX_CHAT_IMAGE_BYTES } from "./chatImageMetadata";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";

const { transfer } = vi.hoisted(() => ({ transfer: vi.fn() }));
vi.mock("@/domains/transport/binaryTransfer", () => ({ transferBinary: transfer }));

const token = "synthetic-blossom-test-token-not-a-live-robot";
const baseUrl = "http://coordinator.test";
const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const file = () => new File([imageBytes], "test.png", { type: "image/png" });
const signal = () => new AbortController().signal;

beforeEach(() => transfer.mockReset().mockResolvedValue(new Uint8Array()));
afterEach(() => vi.restoreAllMocks());

describe("encrypted Blossom images", () => {
  it("uploads ciphertext with upstream-compatible kind 24242 authentication and metadata", async () => {
    const metadata = await uploadChatImage(file(), baseUrl, token, signal());
    const [origin, path, , upload] = transfer.mock.calls[0]!;
    expect([origin, path]).toEqual([baseUrl, "/blossom/upload"]);
    expect(upload.bytes).not.toEqual(imageBytes);
    expect(sha256(upload.bytes)).toBe(metadata.sha256);
    const event = JSON.parse(new TextDecoder().decode(base64.decode(upload.authorization.slice(6))));
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(deriveRobotIdentity(token).nostrPubKey);
    expect(event.kind).toBe(24242);
    expect(event.tags).toEqual([
      ["t", "upload"],
      ["x", metadata.sha256],
      ["expiration", String(event.created_at + 300)]
    ]);
    expect(metadata.url).toBe(`${baseUrl}/blossom/${metadata.sha256}`);
    expect(metadata.originalSha256).toBe(sha256(imageBytes));
    expect(parseChatImage(JSON.stringify(metadata))).toEqual(metadata);
    expect(xchacha20poly1305(base64.decode(metadata.key), base64.decode(metadata.nonce)).decrypt(upload.bytes)).toEqual(
      imageBytes
    );
  });

  it("accepts upstream metadata and downloads only from this trade's configured coordinator", async () => {
    const key = new Uint8Array(32).fill(7);
    const nonce = new Uint8Array(24).fill(3);
    const bytes = xchacha20poly1305(key, nonce).encrypt(imageBytes);
    const hash = sha256(bytes);
    const metadata = parseChatImage(
      JSON.stringify({
        type: "image",
        url: `https://different-gateway.test/blossom/${hash}`,
        mimeType: "image/png",
        key: base64.encode(key),
        nonce: base64.encode(nonce),
        sha256: hash,
        originalSha256: sha256(imageBytes)
      })
    )!;
    transfer.mockResolvedValue(bytes);
    const blob = await downloadChatImage(metadata, baseUrl, signal());
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(imageBytes);
    expect(transfer.mock.calls[0]?.slice(0, 2)).toEqual([baseUrl, `/blossom/${hash}`]);
  });

  it("rejects corrupted ciphertext, authentication tags, and original hashes", async () => {
    const metadata = await uploadChatImage(file(), baseUrl, token, signal());
    const bytes = transfer.mock.calls[0]![3].bytes as Uint8Array;
    transfer.mockResolvedValue(new Uint8Array(bytes).fill(1));
    await expect(downloadChatImage(metadata, baseUrl, signal())).rejects.toThrow("integrity");
    transfer.mockResolvedValue(bytes);
    await expect(
      downloadChatImage({ ...metadata, key: base64.encode(new Uint8Array(32)) }, baseUrl, signal())
    ).rejects.toThrow();
    await expect(downloadChatImage({ ...metadata, originalSha256: "0".repeat(64) }, baseUrl, signal())).rejects.toThrow(
      "integrity"
    );
  });

  it("uses fresh encryption for each image and recovers after an offline upload", async () => {
    transfer.mockRejectedValueOnce(new Error("offline"));
    await expect(uploadChatImage(file(), baseUrl, token, signal())).rejects.toThrow("offline");
    const one = await uploadChatImage(file(), baseUrl, token, signal());
    const two = await uploadChatImage(file(), baseUrl, token, signal());
    expect(one.key).not.toBe(two.key);
    expect(one.nonce).not.toBe(two.nonce);
    expect(one.sha256).not.toBe(two.sha256);
  });

  it("does not upload a cancelled or unsupported file", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadChatImage(file(), baseUrl, token, controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
    await expect(
      uploadChatImage(new File(["<svg/>"], "test.svg", { type: "image/svg+xml" }), baseUrl, token, signal())
    ).rejects.toThrow("Choose");
    const large = file();
    Object.defineProperty(large, "size", { value: MAX_CHAT_IMAGE_BYTES + 1 });
    await expect(uploadChatImage(large, baseUrl, token, signal())).rejects.toThrow("10 MB");
    expect(transfer).not.toHaveBeenCalled();
  });

  it("does not hand off metadata after cancellation during upload", async () => {
    const controller = new AbortController();
    transfer.mockImplementation(async () => {
      controller.abort();
      return new Uint8Array();
    });
    await expect(uploadChatImage(file(), baseUrl, token, controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
  });

  it("rejects malformed metadata without treating ordinary messages as attachments", async () => {
    const metadata = await uploadChatImage(file(), baseUrl, token, signal());
    for (const patch of [
      { key: "bad" },
      { nonce: "bad" },
      { sha256: "bad" },
      { mimeType: "image/svg+xml" },
      { url: "file:///tmp/test" },
      { url: `${metadata.url}?token=do-not-fetch` },
      { url: `${baseUrl}/elsewhere` },
      { originalSha256: "bad" },
      { key: null }
    ])
      expect(parseChatImage(JSON.stringify({ ...metadata, ...patch }))).toBeUndefined();
    expect(parseChatImage('{"type":"image", broken')).toBeUndefined();
    expect(isChatImageMessage("Hello there")).toBe(false);
    expect(isChatImageMessage('{"type":"image", broken')).toBe(true);
    expect(parseChatImage('{"type":"image",' + " ".repeat(4096))).toBeUndefined();
  });
});
