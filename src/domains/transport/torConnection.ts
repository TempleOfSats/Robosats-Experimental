import { useCallback, useEffect, useState } from "react";
import {
  getNativeTorDiagnostics,
  isNativeApp,
  nativeAppBridge,
  requestNativeTorReconnect,
  type AndroidTorDiagnostics
} from "@/domains/transport/androidBridge";
import { getDesktopTorDiagnostics, isTauriDesktop, requestDesktopTorReconnect } from "@/domains/transport/tauriBridge";

export type TorReconnectState = "idle" | "reconnecting" | "reconnected" | "failed";

export type TorConnection = {
  canReconnect: boolean;
  diagnostics: AndroidTorDiagnostics | null;
  reconnectError?: string;
  reconnectState: TorReconnectState;
  reconnect(): Promise<void>;
  refresh(): Promise<void>;
};

type TorReconnectMonitorOptions = {
  completionTimeoutMs?: number;
  desktopRuntime: boolean;
  intervalMs?: number;
  onDiagnostics(diagnostics: AndroidTorDiagnostics): void;
  onFailed(): void;
  onReconnected(): void;
  onUnconfirmed(): void;
  transitionTimeoutMs?: number;
};

const TOR_RECONNECT_TRANSITION_TIMEOUT_MS = 10_000;
const TOR_RECONNECT_COMPLETION_TIMEOUT_MS = 11 * 60_000;

export function useTorConnection(): TorConnection {
  const desktopRuntime = isTauriDesktop();
  const available = desktopRuntime || isNativeApp();
  const canReconnect = desktopRuntime || typeof nativeAppBridge()?.reconnectTorTransport === "function";
  const [diagnostics, setDiagnostics] = useState<AndroidTorDiagnostics | null>(null);
  const [reconnectState, setReconnectState] = useState<TorReconnectState>("idle");
  const [reconnectError, setReconnectError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!available) return;
    setDiagnostics(await readTorDiagnostics(desktopRuntime));
  }, [available, desktopRuntime]);

  useEffect(() => {
    if (!available) return;
    const handleReconnected = () => {
      setReconnectError(undefined);
      setReconnectState((current) => (current === "reconnecting" || current === "failed" ? "reconnected" : current));
      void refresh();
    };
    void refresh();
    window.addEventListener("robosats:tor-reconnected", handleReconnected);
    return () => window.removeEventListener("robosats:tor-reconnected", handleReconnected);
  }, [available, refresh]);

  useEffect(() => {
    if (reconnectState !== "reconnecting") return;
    return registerTorReconnectMonitor({
      desktopRuntime,
      onDiagnostics: setDiagnostics,
      onFailed: () => {
        setReconnectError("Tor could not reconnect. Check your network and try again.");
        setReconnectState("failed");
      },
      onReconnected: () => {
        window.dispatchEvent(new Event("robosats:tor-reconnected"));
      },
      onUnconfirmed: () => {
        setReconnectError("Tor did not confirm the reconnect. You can try again.");
        setReconnectState("failed");
      }
    });
  }, [desktopRuntime, reconnectState]);

  useEffect(() => {
    if (reconnectState !== "reconnected") return;
    const timeout = window.setTimeout(() => setReconnectState("idle"), 4_000);
    return () => window.clearTimeout(timeout);
  }, [reconnectState]);

  const reconnect = useCallback(async () => {
    if (reconnectState === "reconnecting") return;
    setReconnectError(undefined);
    setReconnectState("reconnecting");
    setDiagnostics(markDiagnosticsConnecting);
    try {
      if (!canReconnect) throw new Error("Tor reconnect is unavailable");
      if (desktopRuntime) await requestDesktopTorReconnect();
      else if (!requestNativeTorReconnect()) throw new Error("Tor reconnect is unavailable");
    } catch {
      setReconnectError("Tor could not begin reconnecting. Please try again.");
      setReconnectState("failed");
    }
  }, [canReconnect, desktopRuntime, reconnectState]);

  return {
    canReconnect,
    diagnostics,
    reconnect,
    reconnectError,
    reconnectState,
    refresh
  };
}

export function registerTorReconnectMonitor(options: TorReconnectMonitorOptions): () => void {
  let stopped = false;
  let refreshInFlight = false;
  let observedAttempt = false;
  let completedPolls = 0;
  let interval: number | undefined;
  let transitionTimeout: number | undefined;
  let completionTimeout: number | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (interval !== undefined) window.clearInterval(interval);
    if (transitionTimeout !== undefined) window.clearTimeout(transitionTimeout);
    if (completionTimeout !== undefined) window.clearTimeout(completionTimeout);
  };
  const poll = async () => {
    if (stopped || refreshInFlight) return;
    refreshInFlight = true;
    try {
      const next = await readTorDiagnostics(options.desktopRuntime);
      if (stopped || !next) return;
      options.onDiagnostics(next);
      if (next.state === "connecting" && !observedAttempt) {
        observedAttempt = true;
        if (transitionTimeout !== undefined) window.clearTimeout(transitionTimeout);
        transitionTimeout = undefined;
      }
      if (observedAttempt && next.connected) {
        stop();
        options.onReconnected();
      } else if ((observedAttempt || completedPolls >= 2) && next.state === "failed") {
        stop();
        options.onFailed();
      }
    } catch {
      // Native status can briefly disappear while its Tor runtime is replaced.
    } finally {
      completedPolls += 1;
      refreshInFlight = false;
    }
  };

  void poll();
  interval = window.setInterval(() => void poll(), options.intervalMs ?? 750);
  transitionTimeout = window.setTimeout(() => {
    if (stopped || observedAttempt) return;
    stop();
    options.onUnconfirmed();
  }, options.transitionTimeoutMs ?? TOR_RECONNECT_TRANSITION_TIMEOUT_MS);
  completionTimeout = window.setTimeout(() => {
    if (stopped) return;
    stop();
    options.onUnconfirmed();
  }, options.completionTimeoutMs ?? TOR_RECONNECT_COMPLETION_TIMEOUT_MS);
  return stop;
}

async function readTorDiagnostics(desktopRuntime: boolean): Promise<AndroidTorDiagnostics | null> {
  return desktopRuntime ? getDesktopTorDiagnostics() : getNativeTorDiagnostics();
}

function markDiagnosticsConnecting(current: AndroidTorDiagnostics | null): AndroidTorDiagnostics | null {
  if (!current) return current;
  return {
    ...current,
    connected: false,
    state: "connecting",
    bootstrapProgress: 0,
    proxyRunning: false,
    error: null
  };
}
