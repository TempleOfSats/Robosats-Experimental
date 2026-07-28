import { Check, X } from "lucide-react";
import { useState } from "react";
import { AppTransitionFeedback } from "@/components/app/AppTransitionFeedback";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { activeGarageEntries, decodeGarageToken } from "@/domains/pro/garageVault";
import { useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { recoverGarageSnapshot } from "@/domains/pro/garageSync";
import { activeOfferPresets } from "@/domains/pro/portableSettings";

type RecoveryStage = "idle" | "searching" | "saving" | "complete";

export function GarageRecoveryDialog({ onClose, onRestored }: { onClose: () => void; onRestored?: () => void }) {
  const coordinators = useFederationStore((state) => state.coordinators);
  const restore = useGarageVaultStore((state) => state.restore);
  const [fleetKey, setFleetKey] = useState("");
  const [working, setWorking] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [stage, setStage] = useState<RecoveryStage>("idle");
  const [robotCount, setRobotCount] = useState(0);
  const [presetCount, setPresetCount] = useState(0);
  const [error, setError] = useState("");

  async function confirmRestore() {
    setWorking(true);
    setStage("searching");
    setError("");
    try {
      await waitForFeedbackPaint();
      const normalized = fleetKey.trim();
      let materializedSnapshot = "";
      const applySnapshot = async (snapshot: Awaited<ReturnType<typeof recoverGarageSnapshot>>) => {
        setRobotCount(activeGarageEntries(snapshot.garage).length);
        setPresetCount(activeOfferPresets(snapshot.settings).length);
        setStage("saving");
        await restore(normalized, snapshot);
        materializedSnapshot = JSON.stringify(snapshot);
      };
      const snapshot = await recoverGarageSnapshot(decodeGarageToken(normalized), coordinators, applySnapshot);
      setRobotCount(activeGarageEntries(snapshot.garage).length);
      setPresetCount(activeOfferPresets(snapshot.settings).length);
      setStage("saving");
      if (materializedSnapshot !== JSON.stringify(snapshot)) await restore(normalized, snapshot);
      setStage("complete");
    } catch (restoreError) {
      setStage("idle");
      setError(restoreError instanceof Error ? restoreError.message : "Could not restore Fleet.");
    } finally {
      setWorking(false);
    }
  }

  function closeDialog() {
    if (!working && !finishing) onClose();
  }

  async function finishRecovery() {
    setFinishing(true);
    await waitForFeedbackPaint();
    if (onRestored) onRestored();
    else onClose();
  }

  return (
    <Dialog
      ariaLabelledby="fleet-recovery-title"
      closeOnEscape={!working && !finishing}
      onClose={closeDialog}
      overlayClassName="confirm-overlay"
      panelClassName="confirm-sheet pro-garage-recovery-sheet"
    >
        <header className="garage-switcher-header">
          <div><p className="app-eyebrow">Pro Fleet</p><h3 id="fleet-recovery-title">Restore Fleet</h3></div>
          <button className="icon-button" disabled={working || finishing} onClick={closeDialog} type="button" aria-label="Close Fleet restore"><X size={18} /></button>
        </header>
        {finishing ? (
          <AppTransitionFeedback
            compact
            title="Opening Pro Desk"
            message="Loading your restored Fleet and trade overview..."
          />
        ) : working ? (
          <div className="pro-garage-recovery-progress" aria-live="polite">
            <span className="ui-spinner" aria-hidden="true" />
            <h4>Recovering your robots and presets</h4>
            <p>This could take 1 or 2 minutes.</p>
          </div>
        ) : stage === "complete" ? (
          <div className="pro-garage-recovery-progress" aria-live="polite">
            <span className="pro-garage-recovery-complete" aria-hidden="true"><Check size={22} /></span>
            <h4>Fleet restored</h4>
            <p>
              {robotCount} {robotCount === 1 ? "robot" : "robots"} and {presetCount} {presetCount === 1 ? "preset" : "presets"} are ready in the Trade Desk.
              {robotCount > 1 ? " There is strength in numbers!" : ""}
              {robotCount > 0 ? " Checking coordinator status now." : ""}
            </p>
            <Button onClick={() => void finishRecovery()}>Open Trade Desk</Button>
          </div>
        ) : (
          <>
            <p>Enter your Fleet key to recover its robots and reconnect the Trade Desk on this device.</p>
            <label className="pro-fleet-key-input">
              <span>Fleet key</span>
              <input
                aria-describedby={error ? "fleet-recovery-error" : undefined}
                aria-invalid={Boolean(error)}
                autoComplete="off"
                spellCheck={false}
                value={fleetKey}
                onChange={(event) => {
                  setFleetKey(event.target.value);
                  setError("");
                }}
              />
            </label>
            {error ? <p className="form-error" id="fleet-recovery-error" role="alert">{error}</p> : null}
            <Button disabled={!fleetKey.trim()} onClick={() => void confirmRestore()}>Restore Fleet</Button>
          </>
        )}
    </Dialog>
  );
}

function waitForFeedbackPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}
