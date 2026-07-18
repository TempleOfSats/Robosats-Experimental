import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getNativeTorDiagnostics,
  type NativeTorDiagnostics
} from "@/domains/transport/androidBridge";

export function DesktopTitleBar() {
  const [diagnostics, setDiagnostics] = useState<NativeTorDiagnostics | null>(getNativeTorDiagnostics);

  useEffect(() => {
    const refresh = () => setDiagnostics(getNativeTorDiagnostics());
    window.addEventListener("robosats:desktop-runtime-state", refresh);
    window.addEventListener("robosats:tor-reconnected", refresh);
    return () => {
      window.removeEventListener("robosats:desktop-runtime-state", refresh);
      window.removeEventListener("robosats:tor-reconnected", refresh);
    };
  }, []);

  const status = diagnostics?.connected
    ? "Tor connected"
    : diagnostics?.state === "connecting"
      ? "Tor connecting"
      : "Tor unavailable";

  return (
    <header className="desktop-titlebar">
      <span className="desktop-titlebar-brand">
        <img src="/static/assets/vector/R-notext.svg" alt="" />
        <strong>RoboSats Exp.</strong>
        <small>Desktop</small>
      </span>
      <Link
        className={`desktop-titlebar-status ${diagnostics?.connected ? "connected" : ""}`}
        to="/settings"
        aria-label={`${status}. Open connection settings`}
      >
        <span aria-hidden="true" />
        <span>{status}</span>
      </Link>
    </header>
  );
}
