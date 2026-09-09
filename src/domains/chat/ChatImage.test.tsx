// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatImage, ChatImageComposer } from "./ChatImage";

const { download, upload, prepare } = vi.hoisted(() => ({ download: vi.fn(), upload: vi.fn(), prepare: vi.fn() }));
vi.mock("./chatImages", () => ({ downloadChatImage: download, uploadChatImage: upload }));
vi.mock("./prepareChatImage", () => ({ prepareChatImage: prepare }));
const prepared = new File(["prepared-pixels"], "image", { type: "image/png" });
const metadata = {
  type: "image",
  url: `https://coordinator.test/blossom/${"a".repeat(64)}`,
  sha256: "a".repeat(64),
  mimeType: "image/png",
  key: "A".repeat(43) + "=",
  nonce: "A".repeat(32)
};
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  download.mockReset();
  upload.mockReset().mockResolvedValue(metadata);
  prepare.mockReset().mockResolvedValue(prepared);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-image");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

it("loads only on request, retries failures, enlarges locally and releases the display URL", async () => {
  download
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(new Blob(["synthetic"], { type: "image/png" }));
  await act(async () => root.render(<ChatImage text={JSON.stringify(metadata)} baseUrl="https://coordinator.test" />));
  expect(download).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain(metadata.key);
  await click("Load image");
  expect(document.body.textContent).toContain("Could not load");
  await click("Retry image");
  expect(document.querySelector("img")?.getAttribute("src")).toBe("blob:synthetic-image");
  await act(async () => (document.querySelector(".chat-image-preview") as HTMLButtonElement).click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await click("Close image");
  expect(download).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-image");
});

it("aborts an in-flight download when leaving the chat", async () => {
  download.mockImplementation(() => new Promise(() => undefined));
  await act(async () => root.render(<ChatImage text={JSON.stringify(metadata)} baseUrl="https://coordinator.test" />));
  await click("Load image");
  const signal = download.mock.calls[0]![2] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

it("forgets a displayed attachment when its message or coordinator changes", async () => {
  download.mockResolvedValue(new Blob(["synthetic"], { type: "image/png" }));
  await act(async () => root.render(<ChatImage text={JSON.stringify(metadata)} baseUrl="https://coordinator.test" />));
  await click("Load image");
  expect(document.querySelector("img")).not.toBeNull();
  await act(async () =>
    root.render(<ChatImage text={JSON.stringify(metadata)} baseUrl="https://other-coordinator.test" />)
  );
  expect(document.querySelector("img")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-image");
  expect(download).toHaveBeenCalledOnce();
});

it("keeps malformed image metadata out of the UI and makes no request", async () => {
  await act(async () =>
    root.render(
      <ChatImage text={JSON.stringify({ ...metadata, key: "bad-secret" })} baseUrl="https://coordinator.test" />
    )
  );
  expect(document.body.textContent).toContain("Unsupported or invalid");
  expect(document.body.textContent).not.toContain("bad-secret");
  expect(document.querySelector("button")).toBeNull();
  expect(download).not.toHaveBeenCalled();
});

it("requires explicit send, keeps an uploaded envelope after uncertain delivery, and reuses it on retry", async () => {
  const onSend = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const onClose = vi.fn();
  const file = new File(["synthetic"], "test.png", { type: "image/png" });
  await act(async () =>
    root.render(
      <ChatImageComposer
        file={file}
        baseUrl="https://coordinator.test"
        token="synthetic-token"
        onSend={onSend}
        onClose={onClose}
      />
    )
  );
  expect(upload).not.toHaveBeenCalled();
  expect(URL.createObjectURL).toHaveBeenCalledWith(prepared);
  expect(URL.createObjectURL).not.toHaveBeenCalledWith(file);
  await click("Send image");
  expect(document.body.textContent).toContain("Check the chat before sending again");
  expect(onClose).not.toHaveBeenCalled();
  await click("Send image");
  expect(upload).toHaveBeenCalledOnce();
  expect(upload.mock.calls[0]?.[0]).toBe(prepared);
  expect(prepare).toHaveBeenCalledOnce();
  expect(onSend).toHaveBeenCalledTimes(2);
  expect(onSend.mock.calls[0]?.[0]).toBe(JSON.stringify(metadata));
  expect(onClose).toHaveBeenCalledOnce();
});

it("does not send metadata when the composer is closed during upload", async () => {
  let finish!: (value: typeof metadata) => void;
  upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const onSend = vi.fn();
  await act(async () =>
    root.render(
      <ChatImageComposer
        file={new File(["synthetic"], "test.png", { type: "image/png" })}
        baseUrl="https://coordinator.test"
        token="synthetic-token"
        onSend={onSend}
        onClose={vi.fn()}
      />
    )
  );
  await click("Send image");
  const signal = upload.mock.calls[0]![3] as AbortSignal;
  await act(async () => {
    root.render(null);
  });
  await act(async () => finish(metadata));
  expect(signal.aborted).toBe(true);
  expect(onSend).not.toHaveBeenCalled();
});

it("keeps send disabled until preparation finishes, then previews only the prepared bytes", async () => {
  let finish!: (value: File) => void;
  prepare.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await renderComposer();
  expect(document.body.textContent).toContain("Preparing image…");
  expect(document.querySelector<HTMLButtonElement>(".chat-image-actions button")?.disabled).toBe(true);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  await click("Send image");
  expect(upload).not.toHaveBeenCalled();
  await act(async () => finish(prepared));
  expect(URL.createObjectURL).toHaveBeenCalledWith(prepared);
  expect(document.body.textContent).toContain("Location metadata removed");
  expect(document.querySelector<HTMLButtonElement>(".chat-image-actions button")?.disabled).toBe(false);
});

it("contains preparation failures and offers retry without showing or sending the original", async () => {
  prepare.mockRejectedValueOnce(new Error("private-file-diagnostic")).mockResolvedValue(prepared);
  await renderComposer();
  expect(document.body.textContent).toContain("could not be prepared");
  expect(document.body.textContent).not.toContain("private-file-diagnostic");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLButtonElement>(".chat-image-actions button")?.disabled).toBe(true);
  await click("Retry preparation");
  expect(URL.createObjectURL).toHaveBeenCalledWith(prepared);
  expect(document.querySelector<HTMLButtonElement>(".chat-image-actions button")?.disabled).toBe(false);
});

it("aborts preparation on removal and ignores the late result", async () => {
  let finish!: (value: File) => void;
  prepare.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await renderComposer();
  const signal = prepare.mock.calls[0]![1] as AbortSignal;
  await act(async () => root.render(null));
  await act(async () => finish(prepared));
  expect(signal.aborted).toBe(true);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
});

it("ignores a previous file's late preparation when the selected file changes", async () => {
  let finish!: (value: File) => void;
  prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await renderComposer();
  const previousSignal = prepare.mock.calls[0]![1] as AbortSignal;
  await renderComposer();
  const late = new File(["old-selection"], "old.png", { type: "image/png" });
  await act(async () => finish(late));
  expect(previousSignal.aborted).toBe(true);
  expect(URL.createObjectURL).not.toHaveBeenCalledWith(late);
  await click("Send image");
  expect(upload.mock.calls[0]?.[0]).toBe(prepared);
});

it("disables sending an image that cannot be previewed", async () => {
  await renderComposer();
  await act(async () => document.querySelector("img")?.dispatchEvent(new Event("error")));
  expect(document.body.textContent).toContain("could not be displayed");
  expect(document.querySelector<HTMLButtonElement>(".chat-image-actions button")?.disabled).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-image");
  expect(upload).not.toHaveBeenCalled();
});

it("discards an uploaded envelope if its prepared preview is replaced", async () => {
  const onSend = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <ChatImageComposer
        file={new File(["original"], "test.png", { type: "image/png" })}
        baseUrl="https://coordinator.test"
        token="synthetic-token"
        onSend={onSend}
        onClose={vi.fn()}
      />
    )
  );
  await click("Send image");
  await act(async () => document.querySelector("img")?.dispatchEvent(new Event("error")));
  const replacement = new File(["reprepared-pixels"], "image", { type: "image/png" });
  prepare.mockResolvedValue(replacement);
  await click("Retry preparation");
  await click("Send image");
  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload.mock.calls[1]?.[0]).toBe(replacement);
});

async function renderComposer() {
  await act(async () =>
    root.render(
      <ChatImageComposer
        file={new File(["original"], "test.png", { type: "image/png" })}
        baseUrl="https://coordinator.test"
        token="synthetic-token"
        onSend={vi.fn()}
        onClose={vi.fn()}
      />
    )
  );
}

async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
  expect(button).toBeDefined();
  await act(async () => button?.click());
}
