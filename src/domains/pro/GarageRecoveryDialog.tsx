import { Check, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { AppTransitionFeedback } from "@/domains/navigation/AppTransitionFeedback";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { activeGarageEntries, decodeGarageToken, encodeGarageToken } from "@/domains/pro/garageVault";
import { useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { recoverGarageSnapshot, type GarageRelayQueryProgress } from "@/domains/pro/garageSync";
import { activeOfferPresets } from "@/domains/pro/portableSettings";
import { playHaptic } from "@/lib/haptics";

const MAX_FLEET_BACKUP_FILE_BYTES = 128 * 1024;

type RecoveryStage = "idle" | "searching" | "saving" | "complete";
type RecoveryError = { message: string; source: "backup" | "relay" };

export function GarageRecoveryDialog({
  initialFleetKey = "",
  onClose,
  onRestored
}: {
  initialFleetKey?: string;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const coordinators = useFederationStore((state) => state.coordinators);
  const restore = useGarageVaultStore((state) => state.restore);
  const [fleetKey, setFleetKey] = useState(initialFleetKey);
  const [working, setWorking] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [stage, setStage] = useState<RecoveryStage>("idle");
  const [robotCount, setRobotCount] = useState(0);
  const [presetCount, setPresetCount] = useState(0);
  const [relayProgress, setRelayProgress] = useState<GarageRelayQueryProgress>();
  const [error, setError] = useState<RecoveryError>();
  const [offlineRecovery, setOfflineRecovery] = useState(false);
  const [advancedRecoveryOpen, setAdvancedRecoveryOpen] = useState(false);
  const mounted = useRef(true);
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function confirmRestore() {
    playHaptic("commit");
    await restoreFromRelays(fleetKey);
  }

  async function restoreFromRelays(candidateKey: string) {
    setWorking(true);
    setOfflineRecovery(false);
    setAdvancedRecoveryOpen(false);
    setRelayProgress(undefined);
    setStage("searching");
    setError(undefined);
    try {
      await waitForFeedbackPaint();
      const secret = decodeGarageToken(candidateKey.trim());
      const normalized = encodeGarageToken(secret);
      const { coverage, snapshot } = await recoverGarageSnapshot(secret, coordinators, {
        onProgress: (progress) => {
          if (mounted.current) setRelayProgress(progress);
        }
      });
      if (mounted.current) {
        setRobotCount(activeGarageEntries(snapshot.garage).length);
        setPresetCount(activeOfferPresets(snapshot.settings).length);
        setStage("saving");
      }
      await restore(normalized, snapshot, coverage);
      if (mounted.current) {
        setStage("complete");
        playHaptic("success");
      }
    } catch (restoreError) {
      if (mounted.current) {
        setStage("idle");
        setError(recoveryError(restoreError, "Could not restore Fleet.", "relay"));
      }
    } finally {
      if (mounted.current) setWorking(false);
    }
  }

  async function selectOfflineBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(undefined);
    if (file.size > MAX_FLEET_BACKUP_FILE_BYTES) {
      setAdvancedRecoveryOpen(true);
      setError({ message: "This Fleet backup is too large.", source: "backup" });
      return;
    }

    setWorking(true);
    setOfflineRecovery(true);
    setRelayProgress(undefined);
    setStage("searching");
    playHaptic("commit");
    try {
      await waitForFeedbackPaint();
      setStage("saving");
      const { restoreOfflineFleetBackup } = await import("@/domains/pro/offlineFleetRestore");
      const restored = await restoreOfflineFleetBackup(await file.text());
      setFleetKey(restored.fleetKey);
      if (restored.robotCount === undefined) {
        await restoreFromRelays(restored.fleetKey);
        return;
      }
      setRobotCount(restored.robotCount);
      setPresetCount(0);
      if (mounted.current) {
        setStage("complete");
        playHaptic("success");
      }
    } catch (restoreError) {
      if (mounted.current) {
        setStage("idle");
        setAdvancedRecoveryOpen(true);
        setError(recoveryError(restoreError, "Could not restore this Fleet backup.", "backup"));
        playHaptic("reject");
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
        <div>
          <p className="app-eyebrow">Pro Fleet</p>
          <h3 id="fleet-recovery-title">Restore Fleet</h3>
        </div>
        <button
          className="icon-button"
          disabled={working || finishing}
          onClick={closeDialog}
          type="button"
          aria-label="Close Fleet restore"
        >
          <X size={18} />
        </button>
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
          <h4>{offlineRecovery ? "Opening offline Fleet backup" : "Recovering your robots and presets"}</h4>
          <p>
            {offlineRecovery
              ? "Restoring the saved Robot Fleet on this device."
              : recoveryProgressMessage(relayProgress)}
          </p>
        </div>
      ) : stage === "complete" ? (
        <div className="pro-garage-recovery-progress" aria-live="polite">
          <span className="pro-garage-recovery-complete" aria-hidden="true">
            <Check size={22} />
          </span>
          <h4>Fleet restored</h4>
          <p>{recoveryCompleteCopy(offlineRecovery, robotCount, presetCount)}</p>
          <Button onClick={() => void finishRecovery()}>Open Trade Desk</Button>
        </div>
      ) : (
        <>
          <p>Enter the Fleet key to recover its robots and reconnect this Trade Desk.</p>
          <label className="pro-fleet-key-input">
            <span>Fleet key</span>
            <input
              aria-describedby={error?.source === "relay" ? "fleet-recovery-error" : undefined}
              aria-invalid={error?.source === "relay"}
              autoComplete="off"
              spellCheck={false}
              value={fleetKey}
              onChange={(event) => {
                setFleetKey(event.target.value);
                setError(undefined);
              }}
            />
          </label>
          {error?.source === "relay" ? (
            <p className="form-error" id="fleet-recovery-error" role="alert">
              {error.message}
            </p>
          ) : null}
          <div className="pro-fleet-recovery-actions">
            <Button disabled={!fleetKey.trim()} onClick={() => void confirmRestore()}>
              {error?.source === "relay" ? "Retry" : "Restore Fleet"}
            </Button>
          </div>
          <details
            className="pro-fleet-recovery-advanced"
            open={advancedRecoveryOpen}
            onToggle={(event) => setAdvancedRecoveryOpen(event.currentTarget.open)}
          >
            <summary>Advanced recovery</summary>
            <div className="pro-fleet-recovery-advanced-content">
              <p>Restore from a Fleet backup file saved on this device.</p>
              {error?.source === "backup" ? (
                <p className="form-error" id="fleet-backup-recovery-error" role="alert">
                  {error.message}
                </p>
              ) : null}
              <Button
                aria-describedby={error?.source === "backup" ? "fleet-backup-recovery-error" : undefined}
                variant="ghost"
                onClick={() => backupInput.current?.click()}
              >
                <Upload size={17} /> Choose Fleet backup
              </Button>
            </div>
          </details>
          <input
            ref={backupInput}
            hidden
            type="file"
            accept="application/json,.json"
            aria-label="Choose offline Fleet backup"
            onChange={(event) => void selectOfflineBackup(event)}
          />
        </>
      )}
    </Dialog>
  );
}

function offlineRecoveryCopy(robotCount: number): string {
  const count = robotCount ? `${robotCount} ${robotCount === 1 ? "robot" : "robots"} restored. ` : "Fleet restored. ";
  return `${count}Status, presets, and history reconnect when available.`;
}

function recoveryCompleteCopy(offline: boolean, robotCount: number, presetCount: number): string {
  return offline ? offlineRecoveryCopy(robotCount) : relayRecoveryCopy(robotCount, presetCount);
}

function recoveryError(error: unknown, fallback: string, source: RecoveryError["source"]): RecoveryError {
  return { message: error instanceof Error ? error.message : fallback, source };
}

function relayRecoveryCopy(robotCount: number, presetCount: number): string {
  return `${robotCount} ${robotCount === 1 ? "robot" : "robots"} and ${presetCount} ${presetCount === 1 ? "preset" : "presets"} are ready in the Trade Desk.`;
}

function waitForFeedbackPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

function recoveryProgressMessage(progress?: GarageRelayQueryProgress): string {
  if (!progress) return "Searching coordinator relays. This may take a moment over Tor.";
  if (progress.reachable > 0 && progress.pending > 0) {
    return (
      `${progress.reachable} ${progress.reachable === 1 ? "relay has" : "relays have"} responded. ` +
      `Still checking ${progress.pending} slower ${progress.pending === 1 ? "relay" : "relays"}.`
    );
  }
  if (progress.unavailable > 0 && progress.pending > 0) {
    return (
      `${progress.unavailable} ${progress.unavailable === 1 ? "relay is" : "relays are"} unavailable. ` +
      `Still checking ${progress.pending} ${progress.pending === 1 ? "relay" : "relays"}.`
    );
  }
  if (progress.pending > 0) {
    return `Searching ${progress.pending} coordinator ${progress.pending === 1 ? "relay" : "relays"}. This may take a moment over Tor.`;
  }
  return "Finishing Fleet recovery.";
}
