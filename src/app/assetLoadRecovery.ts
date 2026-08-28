const retryGenerationKey = "robosats:asset-load-retry-generation";

let installed = false;
let reloadScheduled = false;

export function installAssetLoadRecovery(moduleUrl: string): () => void {
  if (installed || typeof window === "undefined") return () => undefined;
  installed = true;

  const generation = assetGeneration(moduleUrl);
  const handlePreloadError = (event: Event) => {
    if (reloadScheduled || !claimReload(generation)) return;

    event.preventDefault();
    reloadScheduled = true;
    window.location.reload();
  };
  window.addEventListener("vite:preloadError", handlePreloadError);

  return () => {
    window.removeEventListener("vite:preloadError", handlePreloadError);
    installed = false;
    reloadScheduled = false;
  };
}

function assetGeneration(moduleUrl: string): string {
  try {
    return new URL(moduleUrl, window.location.href).pathname.match(/\/assets\/([^/]+)\//)?.[1] ?? "development";
  } catch {
    return "development";
  }
}

function claimReload(generation: string): boolean {
  try {
    if (window.sessionStorage.getItem(retryGenerationKey) === generation) return false;
    window.sessionStorage.setItem(retryGenerationKey, generation);
    return window.sessionStorage.getItem(retryGenerationKey) === generation;
  } catch {
    return false;
  }
}
