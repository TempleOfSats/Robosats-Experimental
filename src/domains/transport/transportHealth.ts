import { recordTransportRecovery } from "@/domains/diagnostics/networkPerformance";
import { isAndroidApp, isIOSApp, transportRequest } from "@/domains/transport/androidBridge";
import { requestDesktopTransportRecovery } from "@/domains/transport/tauriBridge";

export type TransportFailureCategory = "timeout" | "connect" | "socket" | "http";

const FAILURE_WINDOW_MS = 30_000;
const RESTART_COOLDOWN_MS = 2 * 60_000;
const PROBE_TIMEOUT_MS = 10_000;
const failures = new Map<string, number>();
let probeOrigins: string[] = [];
let probeInFlight: ProbeAttempt | undefined;
let lastRecoveryAt = 0;
let lifecycleGeneration = 0;
let transportActive = true;

type ProbeAttempt = {
  controller: AbortController;
  promise: Promise<void>;
};

export function setTransportProbeOrigins(origins: string[]): void {
  probeOrigins = [...new Set(origins.map(normalizeOrigin).filter(Boolean))];
}

export function noteTransportReachable(_origin: string): void {
  failures.clear();
}

export function noteTransportFailure(origin: string, category: TransportFailureCategory): void {
  if (category === "http" || !transportActive) return;
  const now = Date.now();
  failures.forEach((at, key) => {
    if (now - at > FAILURE_WINDOW_MS) failures.delete(key);
  });
  const originKey = normalizeOrigin(origin);
  if (!originKey) return;
  failures.set(originKey, now);
  if (failures.size < 2 || probeInFlight) return;
  const controller = new AbortController();
  const generation = lifecycleGeneration;
  let promise: Promise<void>;
  promise = probeTransport(generation, controller.signal).finally(() => {
    if (probeInFlight?.promise === promise) probeInFlight = undefined;
  });
  probeInFlight = { controller, promise };
}

export function setTransportHealthActive(active: boolean): void {
  if (transportActive === active) return;
  transportActive = active;
  lifecycleGeneration += 1;
  failures.clear();
  const staleProbe = probeInFlight;
  probeInFlight = undefined;
  staleProbe?.controller.abort(new DOMException("Transport lifecycle changed", "AbortError"));
}

export function captureTransportLifecycleGeneration(): number {
  return lifecycleGeneration;
}

export function isTransportLifecycleCurrent(generation: number): boolean {
  return transportActive && generation === lifecycleGeneration;
}

export function resetTransportHealthForTests(): void {
  probeInFlight?.controller.abort(new DOMException("Transport health reset", "AbortError"));
  failures.clear();
  probeOrigins = [];
  probeInFlight = undefined;
  lastRecoveryAt = 0;
  lifecycleGeneration += 1;
  transportActive = true;
}

export async function waitForTransportHealthIdleForTests(): Promise<void> {
  await probeInFlight?.promise;
}

async function probeTransport(generation: number, signal: AbortSignal): Promise<void> {
  const targets = probeOrigins.slice(0, 2);
  if (targets.length === 0) return;
  for (const origin of targets) {
    if (!isTransportLifecycleCurrent(generation) || signal.aborted) return;
    try {
      await transportRequest(`${origin}/api/info/`, { method: "GET" }, PROBE_TIMEOUT_MS, signal);
      if (!isTransportLifecycleCurrent(generation) || signal.aborted) return;
      noteTransportReachable(origin);
      return;
    } catch {
      if (!isTransportLifecycleCurrent(generation) || signal.aborted) return;
      // Probe another independent coordinator before recovering the transport.
    }
  }
  if (!isTransportLifecycleCurrent(generation) || signal.aborted) return;
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
