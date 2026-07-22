import { Check, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { activeGarageEntries, decodeGarageToken } from "@/domains/pro/garageVault";
import { useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { recoverGarageSnapshot } from "@/domains/pro/garageSync";

type RecoveryStage = "idle" | "searching" | "saving" | "complete";

export function GarageRecoveryDialog({ onClose, onRestored }: { onClose: () => void; onRestored?: () => void }) {
  const coordinators = useFederationStore((state) => state.coordinators);
  const restore = useGarageVaultStore((state) => state.restore);
  const [fleetKey, setFleetKey] = useState("");
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState<RecoveryStage>("idle");
  const [robotCount, setRobotCount] = useState(0);
  const [error, setError] = useState("");

  async function confirmRestore() {
    setWorking(true);
    setStage("searching");
    setError("");
    try {
      const normalized = fleetKey.trim();
      const snapshot = await recoverGarageSnapshot(decodeGarageToken(normalized), coordinators);
      setRobotCount(activeGarageEntries(snapshot.garage).length);
      setStage("saving");
      await restore(normalized, snapshot);
      setStage("complete");
    } catch (restoreError) {
      setStage("idle");
      setError(restoreError instanceof Error ? restoreError.message : "Could not restore Fleet.");
    } finally {
      setWorking(false);
    }
  }

  function closeDialog() {
    if (!working) onClose();
  }

  function finishRecovery() {
    onRestored?.();
    onClose();
  }

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="fleet-recovery-title" onClick={closeDialog}>
      <section className="confirm-sheet pro-garage-recovery-sheet" onClick={(event) => event.stopPropagation()}>
        <header className="garage-switcher-header">
          <div><p className="app-eyebrow">Pro Fleet</p><h3 id="fleet-recovery-title">Restore Fleet</h3></div>
          <button className="icon-button" disabled={working} onClick={closeDialog} type="button" aria-label="Close Fleet restore"><X size={18} /></button>
        </header>
        {working ? (
          <div className="pro-garage-recovery-progress" aria-live="polite">
            <span className="ui-spinner" aria-hidden="true" />
            <h4>Recovering your robots</h4>
            <p>{stage === "searching" ? "Finding your Fleet. Hang tight." : `Restoring ${robotCount} ${robotCount === 1 ? "robot" : "robots"}.`}</p>
          </div>
        ) : stage === "complete" ? (
          <div className="pro-garage-recovery-progress" aria-live="polite">
            <span className="pro-garage-recovery-complete" aria-hidden="true"><Check size={22} /></span>
            <h4>Fleet restored</h4>
            <p>{robotCount === 0 ? "Your Fleet is ready." : `${robotCount} ${robotCount === 1 ? "robot is" : "robots are"} ready in the Trade Desk.`}</p>
            <Button onClick={finishRecovery}>Open Trade Desk</Button>
          </div>
        ) : (
          <>
            <p>Enter your Fleet key to recover its robots and reconnect the Trade Desk on this device.</p>
            <label className="pro-fleet-key-input">
              <span>Fleet key</span>
              <input autoComplete="off" spellCheck={false} value={fleetKey} onChange={(event) => setFleetKey(event.target.value)} />
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <Button disabled={!fleetKey.trim()} onClick={() => void confirmRestore()}>Restore Fleet</Button>
          </>
        )}
      </section>
    </div>
  );
}
