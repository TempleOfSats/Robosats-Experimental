export async function writeClipboard(value: string): Promise<void> {
  const nativeBridge = window.AndroidAppRobosats ?? window.IOSAppRobosats;
  if (nativeBridge) {
    nativeBridge.copyToClipboard(value);
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}
