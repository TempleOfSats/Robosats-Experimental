import { Check, Copy, Download, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AppTransitionFeedback } from "@/domains/navigation/AppTransitionFeedback";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { downloadFleetKeyBackup } from "@/domains/pro/fleetKeyBackup";
import { useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { writeClipboard } from "@/lib/clipboard";

type FleetSetupProps = {
  onComplete?: () => void;
  onRestore?: () => void;
  onUseStandardGarage?: () => void;
};

export function GarageSetupDialog({ onComplete, onRestore, onUseStandardGarage }: FleetSetupProps) {
  const vaultStatus = useGarageVaultStore((state) => state.status);
  const setup = useGarageVaultStore((state) => state.setup);
  const exportToken = useGarageVaultStore((state) => state.exportToken);
  const markBackedUp = useGarageVaultStore((state) => state.markBackedUp);
  const [fleetKey, setFleetKey] = useState(() => vaultStatus === "needs-backup" ? exportToken() : "");
  const [backedUp, setBackedUp] = useState(false);
  const [working, setWorking] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");

  async function createFleet() {
    setWorking(true);
    setError("");
    try {
      await waitForFeedbackPaint();
      setFleetKey(await setup());
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Could not set up Fleet.");
    } finally {
      setWorking(false);
    }
  }

  async function copyFleetKey() {
    setError("");
    try {
      await writeClipboard(fleetKey);
      setBackedUp(true);
    } catch {
      setError("Clipboard access is unavailable. Download the Fleet key instead.");
    }
  }

  function downloadFleetKey() {
    downloadFleetKeyBackup(fleetKey);
    setBackedUp(true);
  }

  async function finishSetup() {
    setFinishing(true);
    await waitForFeedbackPaint();
    markBackedUp();
    onComplete?.();
    if (!onComplete) setFinishing(false);
  }

  const content = (
    <section className="confirm-sheet pro-garage-setup-sheet">
      {finishing ? (
        <>
          <h3 className="sr-only" id="pro-garage-setup-title">Opening Pro Desk</h3>
          <AppTransitionFeedback
            compact
            title="Opening Pro Desk"
            message="Loading your Fleet and trade overview..."
          />
        </>
      ) : (
        <>
          <header>
            <span className="pro-garage-setup-icon"><ShieldCheck size={22} /></span>
            <div>
              <p className="app-eyebrow">Pro Fleet</p>
              <h3 id="pro-garage-setup-title">Set up your Robot Fleet</h3>
            </div>
          </header>
          {!fleetKey ? (
            <>
              <div className="pro-fleet-setup-copy">
                <p>A Fleet lets you manage several RoboSats robots and their trades from one Trade Desk.</p>
                <p>Each robot remains a standard RoboSats identity recoverable in any RoboSats app. Your Fleet key restores the complete collection on another device.</p>
              </div>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <div className="pro-garage-setup-actions">
                <Button loading={working} onClick={() => void createFleet()}>Set up a new Fleet</Button>
                {onRestore ? <Button disabled={working} variant="outline" onClick={onRestore}>Restore Fleet</Button> : null}
              </div>
              {onUseStandardGarage ? (
                <Button className="pro-use-standard-garage" disabled={working} variant="ghost" onClick={onUseStandardGarage}>Keep standard Garage</Button>
              ) : null}
            </>
          ) : (
            <>
              <p>
                This Fleet key recreates your robots and reconnects the Trade Desk on another device.
                Keep it private because anyone who has it can control those robot identities.
              </p>
              <div className="pro-garage-token-value">
                <code>{fleetKey}</code>
                <div className="pro-fleet-key-actions">
                  <Button size="icon" variant="ghost" aria-label="Copy Fleet key" onClick={() => void copyFleetKey()}>
                    {backedUp ? <Check size={18} /> : <Copy size={18} />}
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Download Fleet key" onClick={downloadFleetKey}>
                    <Download size={18} />
                  </Button>
                </div>
              </div>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <Button disabled={!backedUp} onClick={() => void finishSetup()}>Continue to Trade Desk</Button>
            </>
          )}
        </>
      )}
    </section>
  );

  return (
    <Dialog
      ariaLabelledby="pro-garage-setup-title"
      closeOnEscape={false}
      onClose={() => undefined}
      overlayClassName="confirm-overlay pro-garage-setup-overlay"
      panelClassName="pro-garage-setup-dialog"
    >
      {content}
    </Dialog>
  );
}

function waitForFeedbackPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}
