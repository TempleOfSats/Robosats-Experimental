export type HapticIntent = "selection" | "commit" | "success" | "reject";

export function playHaptic(intent: HapticIntent): void {
  if (typeof window === "undefined") return;
  try {
    (window.AndroidAppRobosats ?? window.IOSAppRobosats)?.performHaptic?.(intent);
  } catch {
    // Tactile feedback is optional and must never interrupt the interaction.
  }
}
