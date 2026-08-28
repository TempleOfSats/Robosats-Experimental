import { lazy, Suspense } from "react";
import { AppTransitionDialog } from "@/domains/navigation/AppTransitionFeedback";

const LazyQuickRobotSetupDialog = lazy(() =>
  import("@/domains/garage/QuickRobotSetup").then((module) => ({
    default: module.QuickRobotSetupDialog
  }))
);

export function QuickRobotSetupPortal({
  onClose,
  onComplete,
  open
}: {
  onClose: () => void;
  onComplete: () => void;
  open: boolean;
}) {
  if (!open) return null;
  return (
    <Suspense
      fallback={
        <AppTransitionDialog
          closeLabel="Close robot setup"
          message="Opening your private trading identity..."
          onClose={onClose}
          title="Preparing robot setup"
        />
      }
    >
      <LazyQuickRobotSetupDialog onClose={onClose} onComplete={onComplete} />
    </Suspense>
  );
}
