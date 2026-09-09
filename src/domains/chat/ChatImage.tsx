import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { isAbortError, toUserMessage } from "@/lib/userError";
import { parseChatImage } from "@/domains/chat/chatImageMetadata";

export function ChatImage({ text, baseUrl }: { text: string; baseUrl?: string }) {
  const [image, setImage] = useState<Blob>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  const url = useImageUrl(image);
  const metadata = parseChatImage(text);
  useEffect(() => {
    setImage(undefined);
    setError("");
    setLoading(false);
    setExpanded(false);
    pending.current = undefined;
    return () => pending.current?.abort();
  }, [text, baseUrl]);

  async function load() {
    if (!metadata || !baseUrl || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    try {
      const { downloadChatImage } = await import("@/domains/chat/chatImages");
      controller.signal.throwIfAborted();
      const blob = await downloadChatImage(metadata, baseUrl, controller.signal);
      controller.signal.throwIfAborted();
      setImage(blob);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(imageError(cause, "Could not load this image. Try again when connected."));
    } finally {
      if (pending.current === controller) {
        pending.current = undefined;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }

  if (!metadata) return <p>Unsupported or invalid image attachment.</p>;
  return (
    <div className="chat-image">
      {url ? (
        <button
          aria-label="Enlarge shared image"
          className="chat-image-preview"
          onClick={() => setExpanded(true)}
          type="button"
        >
          <img
            alt="Shared in this trade"
            src={url}
            onError={() => {
              setImage(undefined);
              setError("This image could not be displayed.");
            }}
          />
        </button>
      ) : (
        <Button
          disabled={!baseUrl || loading}
          loading={loading}
          onClick={() => void load()}
          size="sm"
          type="button"
          variant="outline"
        >
          {loading ? "Loading image…" : error ? "Retry image" : "Load image"}
        </Button>
      )}
      {error ? (
        <p role="status">{error}</p>
      ) : !url ? (
        <p className="chat-image-hint">Encrypted image · loads only when requested</p>
      ) : null}
      {expanded && url ? (
        <Dialog
          ariaLabel="Shared image"
          onClose={() => setExpanded(false)}
          overlayClassName="chat-image-overlay"
          panelClassName="chat-image-dialog"
          dismissOnBackdrop
        >
          <Button onClick={() => setExpanded(false)} size="sm" type="button" variant="outline">
            Close image
          </Button>
          <img alt="Shared in this trade" src={url} />
        </Dialog>
      ) : null}
    </div>
  );
}

export function ChatImageComposer({
  file,
  baseUrl,
  token,
  onSend,
  onClose
}: {
  file: File;
  baseUrl: string;
  token: string;
  onSend: (text: string, signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}) {
  const preparation = usePreparedImage(file);
  const url = useImageUrl(preparation.image);
  const [stage, setStage] = useState<"idle" | "uploading" | "sending">("idle");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | undefined>(undefined);
  const uploaded = useRef<string | undefined>(undefined);
  const attemptedSend = useRef(false);
  useEffect(() => {
    uploaded.current = undefined;
    attemptedSend.current = false;
    setStage("idle");
    setError("");
    return () => {
      pending.current?.abort();
      pending.current = undefined;
    };
  }, [file, baseUrl, token, preparation.image]);

  async function send() {
    if (pending.current || !preparation.image) return;
    const controller = new AbortController();
    pending.current = controller;
    setError("");
    try {
      if (!uploaded.current) {
        setStage("uploading");
        const { uploadChatImage } = await import("@/domains/chat/chatImages");
        controller.signal.throwIfAborted();
        const envelope = await uploadChatImage(preparation.image, baseUrl, token, controller.signal);
        controller.signal.throwIfAborted();
        uploaded.current = JSON.stringify(envelope);
      }
      controller.signal.throwIfAborted();
      setStage("sending");
      attemptedSend.current = true;
      await onSend(uploaded.current, controller.signal);
      controller.signal.throwIfAborted();
      onClose();
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          attemptedSend.current
            ? "Could not confirm delivery. Check the chat before sending again."
            : imageError(cause, "Could not upload this image. The coordinator may not support images yet.")
        );
      }
    } finally {
      if (pending.current === controller) {
        pending.current = undefined;
        if (!controller.signal.aborted) setStage("idle");
      }
    }
  }

  return (
    <div className="chat-image-compose" aria-label="Image to share">
      {url ? <img alt="Selected for sharing" src={url} onError={preparation.failPreview} /> : null}
      <p className="chat-image-hint" role="status">
        {preparation.image
          ? `${imageSize(preparation.image.size)} · Location metadata removed. Check visible personal details.`
          : preparation.error || "Preparing image…"}
      </p>
      {error ? <p role="status">{error}</p> : null}
      <div className="chat-image-actions">
        <Button
          disabled={stage !== "idle" || !preparation.image}
          loading={stage !== "idle"}
          onClick={() => void send()}
          size="sm"
          type="button"
        >
          {stage === "uploading" ? "Uploading image…" : stage === "sending" ? "Sending image…" : "Send image"}
        </Button>
        {preparation.error ? (
          <Button onClick={preparation.retry} size="sm" type="button" variant="outline">
            Retry preparation
          </Button>
        ) : null}
        <Button disabled={stage === "sending"} onClick={onClose} size="sm" type="button" variant="ghost">
          {stage === "uploading" ? "Cancel upload" : "Remove"}
        </Button>
      </div>
    </div>
  );
}

function usePreparedImage(file: File) {
  const [result, setResult] = useState<{ source: File; image: File }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    setError("");
    void import("@/domains/chat/prepareChatImage")
      .then(({ prepareChatImage }) => prepareChatImage(file, controller.signal))
      .then((image) => {
        if (!controller.signal.aborted) setResult({ source: file, image });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(imageError(cause, "This image could not be prepared. Try again or choose another image."));
      });
    return () => controller.abort();
  }, [file, attempt]);
  return {
    image: result?.source === file ? result.image : undefined,
    error,
    retry: () => setAttempt((value) => value + 1),
    failPreview: () => {
      setResult(undefined);
      setError("This image could not be displayed. Choose another image.");
    }
  };
}

function imageSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useImageUrl(blob?: Blob): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function imageError(error: unknown, fallback: string): string {
  if (isAbortError(error)) return "The transfer was interrupted. Try again when connected.";
  // Do not surface server responses, URLs or native bridge diagnostics in chat.
  if (
    error instanceof Error &&
    /^(Choose |This image (failed|is too large)|Image is too large|Update the app)/.test(error.message)
  ) {
    return toUserMessage(error, fallback);
  }
  return fallback;
}
