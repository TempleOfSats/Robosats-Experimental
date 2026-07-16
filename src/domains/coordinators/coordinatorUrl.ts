import type { CoordinatorDefinition, Network, Origin } from "@/domains/coordinators/coordinator.types";

export interface CoordinatorUrlOptions {
  network: Network;
  origin: Origin;
  selfhostedClient?: boolean;
  hostUrl?: string;
  envBaseUrl?: string;
}

export function detectCoordinatorOrigin(
  hostname = typeof window === "undefined" ? "" : window.location.hostname,
  nativeRuntime = typeof window !== "undefined" && (
    typeof window.AndroidAppRobosats?.httpRequest === "function" ||
    typeof window.IOSAppRobosats?.httpRequest === "function"
  )
): Origin {
  if (nativeRuntime) return "onion";
  const normalized = hostname.toLowerCase();
  if (normalized.endsWith(".onion")) return "onion";
  if (normalized.endsWith(".i2p")) return "i2p";
  return "clearnet";
}

export function buildCoordinatorUrl(coordinator: CoordinatorDefinition, options: CoordinatorUrlOptions): string {
  const envBaseUrl = normalizeBaseUrl(options.envBaseUrl);
  if (coordinator.shortAlias === "local" && envBaseUrl) return envBaseUrl;

  if (options.selfhostedClient && coordinator.shortAlias !== "local" && options.hostUrl) {
    return normalizeBaseUrl(`${options.hostUrl}/${options.network}/${coordinator.shortAlias}`);
  }

  const networkUrls = coordinator[options.network];
  return normalizeBaseUrl(networkUrls?.[options.origin] ?? "");
}

function normalizeBaseUrl(value?: string | null): string {
  if (!value) return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
