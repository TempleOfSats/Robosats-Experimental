import { Check, Copy, Download, KeyRound, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { downloadOfflineFleetBackup } from "@/domains/pro/fleetKeyBackup";
import type { GarageBackupVerification } from "@/domains/pro/garageBackupVerification";
import { useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { writeClipboard } from "@/lib/clipboard";
import { playHaptic } from "@/lib/haptics";

type FleetBackupVerificationState =
  | { status: "checking" }
  | { status: "pending"; result?: GarageBackupVerification }
  | { status: "verified"; result: GarageBackupVerification };

export function FleetKeyDialog({
  fleetKey,
  onClose,
  onVerify = verifyFleetBackup
}: {
  fleetKey: string;
  onClose: () => void;
  onVerify?: () => Promise<GarageBackupVerification>;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState<FleetBackupVerificationState>({ status: "checking" });
  const verificationAttempt = useRef(0);

  const verifyBackup = useCallback(async () => {
    const attempt = ++verificationAttempt.current;
    setVerification({ status: "checking" });
    playHaptic("commit");
    try {
      const result = await onVerify();
      if (attempt !== verificationAttempt.current) return;
      if (result.verified) playHaptic("success");
      setVerification(result.verified ? { status: "verified", result } : { status: "pending", result });
    } catch {
      if (attempt === verificationAttempt.current) setVerification({ status: "pending" });
    }
  }, [onVerify]);

  useEffect(() => {
    void verifyBackup();
    return () => {
      verificationAttempt.current += 1;
    };
  }, [verifyBackup]);

  async function copyFleetKey() {
    setError("");
    try {
      await writeClipboard(fleetKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setError("Clipboard access is unavailable. Download the offline Fleet backup instead.");
    }
  }

  function downloadFleetKey() {
    setError("");
    const manifest = useGarageVaultStore.getState().manifest;
    if (!manifest) {
      setError("The local Fleet is not ready to back up yet.");
      return;
    }
    try {
      downloadOfflineFleetBackup(fleetKey, manifest);
    } catch {
      setError("Could not prepare the offline Fleet backup.");
    }
  }

  const verificationCopy = fleetBackupVerificationCopy(verification);

  return (
    <Dialog
      ariaLabelledby="fleet-key-title"
      onClose={onClose}
      overlayClassName="confirm-overlay"
      panelClassName="confirm-sheet pro-fleet-key-sheet"
    >
      <header className="garage-switcher-header">
        <div className="pro-fleet-key-heading">
          <h3 id="fleet-key-title">Back up Fleet</h3>
          <span className="pro-fleet-key-mark" aria-hidden="true">
            <KeyRound size={20} />
          </span>
        </div>
        <button className="icon-button" onClick={onClose} type="button" aria-label="Close Fleet backup">
          <X size={18} />
        </button>
      </header>
      <p>
        Copy the private key or download an offline backup of the current Robot Fleet. Keep either one private because
        it controls those robot identities.
      </p>
      <div
        className="pro-fleet-backup-status"
        data-state={verification.status}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="pro-fleet-backup-status-icon" aria-hidden="true">
          {verification.status === "checking" ? (
            <span className="ui-spinner" />
          ) : verification.status === "verified" ? (
            <ShieldCheck size={19} />
          ) : (
            <RefreshCw size={18} />
          )}
        </span>
        <span className="pro-fleet-backup-status-copy">
          <strong>{verificationCopy.title}</strong>
          <small>{verificationCopy.detail}</small>
        </span>
        {verification.status === "pending" ? (
          <Button size="sm" variant="ghost" onClick={() => void verifyBackup()}>
            Retry
          </Button>
        ) : null}
      </div>
      <div className="pro-garage-token-value">
        <code>{fleetKey}</code>
        <div className="pro-fleet-key-actions">
          <Button size="icon" variant="ghost" aria-label="Copy Fleet key" onClick={() => void copyFleetKey()}>
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </Button>
          <Button
            size="icon"
            title="Download offline Fleet backup"
            variant="ghost"
            aria-label="Download offline Fleet backup"
            onClick={downloadFleetKey}
          >
            <Download size={18} />
          </Button>
        </div>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

async function verifyFleetBackup(): Promise<GarageBackupVerification> {
  const { verifyCurrentFleetBackup } = await import("@/domains/pro/proRuntime");
  return verifyCurrentFleetBackup();
}

function fleetBackupVerificationCopy(verification: FleetBackupVerificationState): { detail: string; title: string } {
  if (verification.status === "checking") {
    return {
      title: "Securing latest Fleet…",
      detail: "Publishing and checking the latest records over Tor."
    };
  }
  if (verification.status === "verified") {
    const relayCopy =
      verification.result.verifiedRelays === 1 ? "1 relay has" : `${verification.result.verifiedRelays} relays have`;
    return {
      title: "Fleet synced",
      detail: `${relayCopy} the latest encrypted records. The download saves the robots currently on this device.`
    };
  }
  if (verification.result && verification.result.verifiedRelays > 0) {
    return {
      title: "Verification pending",
      detail: `Latest Fleet read back from ${verification.result.verifiedRelays} of ${verification.result.requiredRelays} required relays. Retry when Tor connectivity improves.`
    };
  }
  return {
    title: "Verification pending",
    detail: "Your Fleet remains saved on this device. Retry when Tor relays are reachable."
  };
}
