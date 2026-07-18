import { Maximize2, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { getDesktopTorDiagnostics } from "@/domains/transport/tauriBridge";

export function DesktopTitleBar() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    const refresh = () => {
      void getDesktopTorDiagnostics().then((diagnostics) => {
        setConnected(Boolean(diagnostics?.connected));
        setConnecting(diagnostics?.state === "connecting");
      });
    };
    refresh();
    window.addEventListener("robosats:desktop-runtime-state", refresh);
    window.addEventListener("robosats:tor-reconnected", refresh);
    return () => {
      window.removeEventListener("robosats:desktop-runtime-state", refresh);
      window.removeEventListener("robosats:tor-reconnected", refresh);
    };
  }, []);

  const status = connected ? "Tor connected" : connecting ? "Tor connecting" : "Tor unavailable";

  return (
    <header className="desktop-titlebar" data-tauri-drag-region>
      <span className="desktop-titlebar-brand" data-tauri-drag-region>
        <img src="/static/assets/vector/R-notext.svg" alt="" />
        <strong data-tauri-drag-region>RoboSats Exp.</strong>
        <small data-tauri-drag-region>Desktop</small>
      </span>
      <span className="desktop-titlebar-actions">
        <Link
          className={`desktop-titlebar-status ${connected ? "connected" : ""}`}
          to="/settings"
          aria-label={`${status}. Open connection settings`}
        >
          <span aria-hidden="true" />
          <span>{status}</span>
        </Link>
        <TitleBarButton label="Minimize" action="minimize"><Minus size={15} /></TitleBarButton>
        <TitleBarButton label="Maximize or restore" action="toggleMaximize"><Maximize2 size={14} /></TitleBarButton>
        <TitleBarButton label="Close RoboSats" action="quit" danger><X size={16} /></TitleBarButton>
      </span>
    </header>
  );
}

function TitleBarButton({
  action,
  children,
  danger = false,
  label
}: {
  action: "minimize" | "toggleMaximize" | "quit";
  children: ReactNode;
  danger?: boolean;
  label: string;
}) {
  return (
    <button
      className={`desktop-window-command ${danger ? "desktop-window-command-danger" : ""}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        if (action === "quit") {
          void import("@tauri-apps/api/core").then(({ invoke }) => invoke("desktop_quit"));
          return;
        }
        void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow()[action]());
      }}
    >
      {children}
    </button>
  );
}
