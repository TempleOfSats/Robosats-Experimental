import { QuickRobotSetupDialog } from "@/domains/garage/QuickRobotSetup";

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
  return <QuickRobotSetupDialog onClose={onClose} onComplete={onComplete} />;
}
