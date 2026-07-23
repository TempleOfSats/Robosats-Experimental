import { recordTransportRecovery } from "@/domains/diagnostics/networkPerformance";
import { isAndroidApp, isIOSApp, transportRequest } from "@/domains/transport/androidBridge";
import { requestDesktopTransportRecovery } from "@/domains/transport/tauriBridge";

export type TransportFailureCategory = "timeout" | "connect" | "socket" | "http";

const FAILURE_WINDOW_MS = 30_000;
const RESTART_COOLDOWN_MS = 2 * 60_000;
const PROBE_TIMEOUT_MS = 10_000;
const failures = new Map<string, number>();
let probeOrigins: string[] = [];
let probeInFlight: Promise<void> | undefined;
let lastRecoveryAt = 0;

export function setTransportProbeOrigins(origins: string[]): void {
  probeOrigins = [...new Set(origins.map(normalizeOrigin).filter(Boolean))];
}

export function noteTransportReachable(_origin: string): void {
  failures.clear();
}

export function noteTransportFailure(origin: string, category: TransportFailureCategory): void {
  if (category === "http") return;
  const now = Date.now();
  failures.forEach((at, key) => {
    if (now - at > FAILURE_WINDOW_MS) failures.delete(key);
  });
  const originKey = normalizeOrigin(origin);
  if (!originKey) return;
  failures.set(originKey, now);
  if (failures.size < 2 || probeInFlight) return;
  probeInFlight = probeTransport().finally(() => {
    probeInFlight = undefined;
  });
}

export function resetTransportHealthForTests(): void {
  failures.clear();
  probeOrigins = [];
  probeInFlight = undefined;
  lastRecoveryAt = 0;
}

export async function waitForTransportHealthIdleForTests(): Promise<void> {
  await probeInFlight;
}

async function probeTransport(): Promise<void> {
  const targets = probeOrigins.slice(0, 2);
  if (targets.length === 0) return;
  for (const origin of targets) {
    try {
      await transportRequest(`${origin}/api/info/`, { method: "GET" }, PROBE_TIMEOUT_MS);
      noteTransportReachable(origin);
      return;
    } catch {
      // Probe another independent coordinator before recovering the transport.
    }
  }
  const now = Date.now();
  if (now - lastRecoveryAt < RESTART_COOLDOWN_MS) return;
  lastRecoveryAt = now;
  const bridge = typeof window === "undefined"
    ? undefined
    : window.AndroidAppRobosats ?? window.IOSAppRobosats;
  if (bridge?.recoverTorTransport) {
    recordTransportRecovery(isIOSApp() ? "ios" : isAndroidApp() ? "android" : "android");
    bridge.recoverTorTransport();
    return;
  }
  recordTransportRecovery("desktop");
  await requestDesktopTransportRecovery();
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}
