import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/dialog";

type AppTransitionFeedbackProps = {
  title: string;
  message: string;
  compact?: boolean;
};

export function AppTransitionFeedback({
  title,
  message,
  compact = false
}: AppTransitionFeedbackProps) {
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

export function AppTransitionDialog({
  title,
  message
}: Omit<AppTransitionFeedbackProps, "compact">) {
  return (
    <Dialog
      ariaLabel={title}
      closeOnEscape={false}
      onClose={() => undefined}
      overlayClassName="confirm-overlay app-transition-overlay"
      panelClassName="confirm-sheet app-transition-dialog"
    >
      <AppTransitionFeedback title={title} message={message} />
    </Dialog>
  );
}
