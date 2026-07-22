import { Check, Copy, Download, KeyRound, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadFleetKeyBackup } from "@/domains/pro/fleetKeyBackup";
import { useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { writeClipboard } from "@/lib/clipboard";

export function FleetKeyDialog({ onClose }: { onClose: () => void }) {
  const exportToken = useGarageVaultStore((state) => state.exportToken);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const fleetKey = exportToken();

  async function copyFleetKey() {
    setError("");
    try {
      await writeClipboard(fleetKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setError("Clipboard access is unavailable. Download the Fleet key instead.");
    }
  }

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="fleet-key-title" onClick={onClose}>
      <section className="confirm-sheet pro-fleet-key-sheet" onClick={(event) => event.stopPropagation()}>
        <header className="garage-switcher-header">
          <div className="pro-fleet-key-heading">
            <h3 id="fleet-key-title">Back up Fleet key</h3>
            <span className="pro-fleet-key-mark" aria-hidden="true"><KeyRound size={20} /></span>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close Fleet key backup"><X size={18} /></button>
        </header>
        <p>
          This key recreates every robot in your Fleet and reconnects the Trade Desk on another device.
          Keep it private because anyone who has it can control those robot identities.
        </p>
        <div className="pro-garage-token-value">
          <code>{fleetKey}</code>
          <div className="pro-fleet-key-actions">
            <Button size="icon" variant="ghost" aria-label="Copy Fleet key" onClick={() => void copyFleetKey()}>
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </Button>
            <Button size="icon" variant="ghost" aria-label="Download Fleet key" onClick={() => downloadFleetKeyBackup(fleetKey)}>
              <Download size={18} />
            </Button>
          </div>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
