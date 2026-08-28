import { ArrowRight, Dices } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RobotRequiredActions({
  detail,
  onCreateRobot,
  onOpenGarage,
  title
}: {
  detail: string;
  onCreateRobot: () => void;
  onOpenGarage: () => void;
  title: string;
}) {
  return (
    <div className="robot-required-notice" role="status">
      <span className="robot-required-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span className="robot-required-actions">
        <Button onClick={onCreateRobot} size="sm" type="button">
          <Dices size={16} />
          Create robot
        </Button>
        <Button onClick={onOpenGarage} size="sm" type="button" variant="ghost">
          Garage
          <ArrowRight size={15} />
        </Button>
      </span>
    </div>
  );
}
