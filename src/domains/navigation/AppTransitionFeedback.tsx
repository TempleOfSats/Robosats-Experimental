import { X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

type AppTransitionFeedbackProps = {
  title: string;
  message: string;
  compact?: boolean;
};

export function AppTransitionFeedback({ title, message, compact = false }: AppTransitionFeedbackProps) {
  return (
    <div
      className={cn("app-transition-feedback", compact && "app-transition-feedback-compact")}
      role="status"
      aria-live="polite"
    >
      <span className="app-transition-mark" aria-hidden="true">
        <img src="/static/assets/vector/R-notext.svg" alt="" />
      </span>
      <span className="app-transition-copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </span>
    </div>
  );
}

type AppTransitionDialogProps = Omit<AppTransitionFeedbackProps, "compact"> & {
  closeLabel?: string;
  onClose?: () => void;
};

export function AppTransitionDialog({ closeLabel, message, onClose, title }: AppTransitionDialogProps) {
  return (
    <Dialog
      ariaLabel={title}
      closeOnEscape={Boolean(onClose)}
      onClose={onClose ?? ignoreClose}
      overlayClassName="confirm-overlay app-transition-overlay"
      panelClassName="confirm-sheet app-transition-dialog"
    >
      {onClose ? (
        <button
          aria-label={closeLabel ?? `Close ${title.toLowerCase()}`}
          className="take-modal-close"
          onClick={onClose}
          type="button"
        >
          <X size={18} />
        </button>
      ) : null}
      <AppTransitionFeedback title={title} message={message} />
    </Dialog>
  );
}

function ignoreClose() {}
