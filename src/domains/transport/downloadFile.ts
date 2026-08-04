import { nativeAppBridge } from "@/domains/transport/androidBridge";
import { isTauriDesktop, saveDesktopFile } from "@/domains/transport/tauriBridge";

/** Save exports through the host platform, with a browser fallback. */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  if (isTauriDesktop()) {
    void saveDesktopFile(filename, content).catch(() => triggerBrowserDownload(filename, content, mimeType));
    return;
  }

  const bridge = nativeAppBridge();
  if (bridge?.saveFile) {
    try {
      if (bridge.saveFile(filename, mimeType, encodeBase64(content))) return;
    } catch {
      // Fall back to the browser path when a host save request cannot start.
    }
  }

  triggerBrowserDownload(filename, content, mimeType);
}

function triggerBrowserDownload(filename: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body?.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // WebKit can cancel a download if its object URL is revoked in the same tick.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
