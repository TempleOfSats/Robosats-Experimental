import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppTransitionFeedback } from "@/domains/navigation/AppTransitionFeedback";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import {
  activeGarageEntries,
  decodeGarageToken,
  encodeGarageToken
} from "@/domains/pro/garageVault";
import { useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import {
  recoverGarageSnapshot,
  type GarageRelayQueryProgress
} from "@/domains/pro/garageSync";
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
  const [reconciling, setReconciling] = useState(false);
  const [relayProgress, setRelayProgress] = useState<GarageRelayQueryProgress>();
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function confirmRestore() {
    setWorking(true);
    setReconciling(false);
    setRelayProgress(undefined);
    setStage("searching");
    setError("");
    let materialized = false;
    try {
      await waitForFeedbackPaint();
      const secret = decodeGarageToken(fleetKey.trim());
      const normalized = encodeGarageToken(secret);
      await recoverGarageSnapshot(secret, coordinators, {
        onProgress: (progress) => {
          if (mounted.current) setRelayProgress(progress);
        },
        onFirstSnapshot: async (snapshot) => {
          if (mounted.current) {
            setRobotCount(activeGarageEntries(snapshot.garage).length);
            setPresetCount(activeOfferPresets(snapshot.settings).length);
            setStage("saving");
          }
          await restore(normalized, snapshot);
          materialized = true;
          if (mounted.current) setReconciling(true);
        },
        onRecordsComplete: (records) => {
          const vault = useGarageVaultStore.getState();
          try {
            if (!materialized || vault.exportToken() !== normalized) return;
            vault.applyRemoteRecords(records);
            if (mounted.current) {
              const current = useGarageVaultStore.getState();
              setRobotCount(current.manifest ? activeGarageEntries(current.manifest).length : 0);
              setPresetCount(activeOfferPresets(current.envelope?.settings).length);
            }
          } finally {
            if (mounted.current) setReconciling(false);
          }
        }
      });
      if (mounted.current) {
        setStage("complete");
        setReconciling(false);
      }
    } catch (restoreError) {
      if (mounted.current) {
        if (materialized) {
          setStage("complete");
          setReconciling(false);
        } else {
          setStage("idle");
          setError(restoreError instanceof Error ? restoreError.message : "Could not restore Fleet.");
        }
      }
    } finally {
      if (mounted.current) setWorking(false);
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
            <p>{recoveryProgressMessage(relayProgress)}</p>
          </div>
        ) : stage === "complete" ? (
          <div className="pro-garage-recovery-progress" aria-live="polite">
            <span className="pro-garage-recovery-complete" aria-hidden="true"><Check size={22} /></span>
            <h4>Fleet restored</h4>
            <p>
              {robotCount} {robotCount === 1 ? "robot" : "robots"} and {presetCount} {presetCount === 1 ? "preset" : "presets"} are ready in the Trade Desk.
              {robotCount > 1 ? " There is strength in numbers!" : ""}
              {reconciling
                ? " Slower coordinator relays are still being reconciled in the background."
                : robotCount > 0
                  ? " Checking coordinator status now."
                  : ""}
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

function recoveryProgressMessage(progress?: GarageRelayQueryProgress): string {
  if (!progress) return "Searching coordinator relays. This could take 1 or 2 minutes.";
  if (progress.reachable > 0 && progress.pending > 0) {
    return `${progress.reachable} ${progress.reachable === 1 ? "relay has" : "relays have"} responded. `
      + `Still checking ${progress.pending} slower ${progress.pending === 1 ? "relay" : "relays"}.`;
  }
  if (progress.unavailable > 0 && progress.pending > 0) {
    return `${progress.unavailable} ${progress.unavailable === 1 ? "relay is" : "relays are"} unavailable. `
      + `Still checking ${progress.pending} ${progress.pending === 1 ? "relay" : "relays"}.`;
  }
  if (progress.pending > 0) {
    return `Searching ${progress.pending} coordinator ${progress.pending === 1 ? "relay" : "relays"}. This could take 1 or 2 minutes.`;
  }
  return "Finishing Fleet recovery.";
}
