import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { AndroidTorDiagnostics } from "@/domains/transport/androidBridge";
import type { TorConnection, TorReconnectState } from "@/domains/transport/torConnection";

type TorConnectionDialogProps = TorConnection & {
  onClose(): void;
};

export function TorConnectionDialog({
  diagnostics,
  reconnect,
  reconnectError,
  reconnectState,
  onClose
}: TorConnectionDialogProps) {
  const reconnecting = reconnectState === "reconnecting";
  const healthClass = reconnecting
    ? "settings-tor-health reconnecting"
    : `settings-tor-health ${diagnostics?.connected ? "connected" : ""}`;
  const error = reconnectError ?? diagnostics?.error;

  return (
    <Dialog
      ariaLabelledby="tor-details-title"
      dismissOnBackdrop
      onClose={onClose}
      overlayClassName="confirm-overlay"
      panelClassName="confirm-sheet settings-tor-dialog"
    >
      <header className="settings-tor-dialog-header">
        <span className="settings-onion-mark settings-onion-mark-large">
          <OnionIcon />
        </span>
        <span>
          <h3 id="tor-details-title">Tor connection</h3>
          <p>{reconnecting ? "Reconnecting..." : torStatusLabel(diagnostics)}</p>
        </span>
        <Button size="icon" variant="ghost" aria-label="Close Tor details" onClick={onClose}>
          <X size={18} />
        </Button>
      </header>
      <TorConnectionHealth
        className={healthClass}
        diagnostics={diagnostics}
        reconnecting={reconnecting}
        reconnectState={reconnectState}
      />
      <TorConnectionDetails diagnostics={diagnostics} reconnecting={reconnecting} />
      <p className="settings-tor-reconnect-copy">
        If Tor feels stuck, reconnecting replaces live connections and circuits. Robots, trades and settings stay
        unchanged.
      </p>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        variant="outline"
        className="full-width"
        loading={reconnecting}
        loadingLabel="Reconnecting Tor"
        onClick={() => void reconnect()}
      >
        {!reconnecting ? <RefreshCw size={16} aria-hidden="true" /> : null}
        {torReconnectButtonLabel(diagnostics, reconnectState)}
      </Button>
    </Dialog>
  );
}

function TorConnectionHealth({
  className,
  diagnostics,
  reconnecting,
  reconnectState
}: {
  className: string;
  diagnostics: AndroidTorDiagnostics | null;
  reconnecting: boolean;
  reconnectState: TorReconnectState;
}) {
  return (
    <div className={className} role="status" aria-live="polite">
      {reconnecting ? <span className="ui-spinner" aria-hidden="true" /> : <span aria-hidden="true" />}
      {torHealthLabel(diagnostics, reconnectState)}
    </div>
  );
}

function TorConnectionDetails({
  diagnostics,
  reconnecting
}: {
  diagnostics: AndroidTorDiagnostics | null;
  reconnecting: boolean;
}) {
  return (
    <dl className="settings-tor-details">
      <div>
        <dt>State</dt>
        <dd>{reconnecting ? "reconnecting" : (diagnostics?.state ?? "Unavailable")}</dd>
      </div>
      <div>
        <dt>Engine</dt>
        <dd>{diagnostics?.implementation ?? "Arti"}</dd>
      </div>
      <div>
        <dt>Arti build</dt>
        <dd>{diagnostics?.artiVersion ?? "Unavailable"}</dd>
      </div>
      <div>
        <dt>Native client</dt>
        <dd>{diagnostics?.clientInitialized && diagnostics.proxyRunning ? "Ready" : "Not ready"}</dd>
      </div>
      <div>
        <dt>SOCKS proxy</dt>
        <dd>{socksAddress(diagnostics)}</dd>
      </div>
      <div>
        <dt>Network</dt>
        <dd>{diagnostics?.networkAvailable ? "Available" : "Unavailable"}</dd>
      </div>
      <div>
        <dt>Routing</dt>
        <dd>{diagnostics?.routing ?? "Native Tor transport"}</dd>
      </div>
      <div>
        <dt>App</dt>
        <dd>RoboSats Exp. {diagnostics?.appVersion ?? ""}</dd>
      </div>
    </dl>
  );
}

export function torStatusLabel(diagnostics: AndroidTorDiagnostics | null): string {
  if (!diagnostics) return "Checking...";
  if (diagnostics.connected) return "Connected";
  if (diagnostics.state === "connecting") return "Connecting...";
  if (diagnostics.state === "failed") return "Connection failed";
  return "Disconnected";
}

export function OnionIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3c0 2.3-1.7 3.2-3.4 4.3C6.4 8.7 5 10.6 5 13.2A7 7 0 0 0 19 13c0-2.5-1.4-4.4-3.6-5.8C13.7 6.1 12 5.2 12 3Z" />
      <path d="M12 7.1c0 1.5-1 2.2-2.1 3.1-1.1.8-1.8 1.8-1.8 3.2a3.9 3.9 0 0 0 7.8 0c0-1.4-.7-2.4-1.8-3.2C13 9.3 12 8.6 12 7.1Z" />
      <path d="M12 11.3c-.8.8-1.4 1.4-1.4 2.4a1.4 1.4 0 0 0 2.8 0c0-1-.6-1.6-1.4-2.4Z" />
    </svg>
  );
}

function torHealthLabel(diagnostics: AndroidTorDiagnostics | null, state: TorReconnectState): string {
  if (state === "reconnecting") {
    const progress = diagnostics?.bootstrapProgress;
    return `Establishing fresh Tor circuits${progress ? ` · ${progress}%` : "..."}`;
  }
  if (state === "reconnected") return "Tor reconnected with fresh circuits";
  return diagnostics?.connected ? "Traffic is routed through Tor" : "Tor is not ready";
}

function torReconnectButtonLabel(diagnostics: AndroidTorDiagnostics | null, state: TorReconnectState): string {
  if (state === "reconnecting") return "Reconnecting Tor";
  if (state === "failed" || diagnostics?.state === "failed") return "Retry Tor";
  return "Reconnect Tor";
}

function socksAddress(diagnostics: AndroidTorDiagnostics | null): string {
  if (!diagnostics?.socksHost || !diagnostics.socksPort) return "Not listening";
  return `${diagnostics.socksHost}:${diagnostics.socksPort}`;
}
