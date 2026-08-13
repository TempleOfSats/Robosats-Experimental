import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { GarageRecoveryDialog } from "@/domains/pro/GarageRecoveryDialog";
import { GarageSetupDialog } from "@/domains/pro/GarageSetupDialog";
import type { GarageVaultStatus } from "@/domains/pro/garageVaultStore";

export function FleetVaultDialogs({
  error,
  onCloseRecovery,
  onComplete,
  onRestore,
  onUseStandardGarage,
  recoveryOpen,
  setupOpen,
  status
}: {
  error?: string;
  onCloseRecovery: () => void;
  onComplete: () => void;
  onRestore: () => void;
  onUseStandardGarage: () => void;
  recoveryOpen: boolean;
  setupOpen: boolean;
  status: GarageVaultStatus;
}) {
  if (recoveryOpen) {
    return <GarageRecoveryDialog onClose={onCloseRecovery} onRestored={onComplete} />;
  }
  if (status === "error") {
    return (
      <FleetRecoveryErrorDialog
        message={error ?? "This device's Fleet could not be opened."}
        onRestore={onRestore}
        onUseStandardGarage={onUseStandardGarage}
      />
    );
  }
  if (setupOpen || status === "unconfigured" || status === "needs-backup") {
    return (
      <GarageSetupDialog onComplete={onComplete} onRestore={onRestore} onUseStandardGarage={onUseStandardGarage} />
    );
  }
  return null;
}

function FleetRecoveryErrorDialog({
  message,
  onRestore,
  onUseStandardGarage
}: {
  message: string;
  onRestore: () => void;
  onUseStandardGarage: () => void;
}) {
  return (
    <Dialog
      ariaLabelledby="pro-fleet-recovery-error-title"
      closeOnEscape={false}
      onClose={() => undefined}
      overlayClassName="confirm-overlay pro-garage-setup-overlay"
      panelClassName="pro-garage-setup-dialog"
    >
      <section className="confirm-sheet pro-garage-setup-sheet">
        <header>
          <span className="pro-garage-setup-icon">
            <AlertTriangle size={22} />
          </span>
          <div>
            <p className="app-eyebrow">Fleet recovery</p>
            <h3 id="pro-fleet-recovery-error-title">Saved Fleet needs attention</h3>
          </div>
        </header>
        <p>{message}</p>
        <p className="muted-copy">
          Nothing was erased. Restoring a valid Fleet backup safely replaces the unreadable local copy.
        </p>
        <div className="pro-garage-setup-actions">
          <Button onClick={onRestore}>Restore Fleet</Button>
          <Button variant="outline" onClick={onUseStandardGarage}>
            Use standard Garage
          </Button>
        </div>
      </section>
    </Dialog>
  );
}
