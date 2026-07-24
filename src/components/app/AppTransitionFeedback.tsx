import { cn } from "@/lib/cn";

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
    <div
      className="confirm-overlay app-transition-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <section className="confirm-sheet app-transition-dialog">
        <AppTransitionFeedback title={title} message={message} />
      </section>
    </div>
  );
}
