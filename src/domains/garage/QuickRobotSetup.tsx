import { X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { CreateRobotPanel } from "@/domains/garage/CreateRobotPanel";

export function QuickRobotSetupDialog({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  return (
    <Dialog
      ariaLabel="Create or restore a robot"
      onClose={onClose}
      overlayClassName="confirm-overlay quick-robot-setup-overlay"
      panelClassName="confirm-sheet quick-robot-setup-dialog"
    >
      <button
        aria-label="Close robot setup"
        className="icon-button quick-robot-setup-close"
        onClick={onClose}
        type="button"
      >
        <X size={18} />
      </button>
      <CreateRobotPanel onComplete={onComplete} />
    </Dialog>
  );
}
