import { AlertTriangle, ChevronRight, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { useGarageStore, type RobotSlot } from "@/domains/garage/garageStore";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { RobotGlyph } from "@/domains/pro/ProWorkspaceIcons";
import type { OfferReadyRobots } from "@/domains/pro/proRobotLifecycle";
import { GARAGE_LIMITS } from "@/domains/pro/garageVault";
import "@/domains/pro/proRobotPicker.css";

export function CreateOfferRobotPicker({
  addingRobot = false,
  emptyMessage,
  fleetFull = false,
  onAddRobot,
  onClose,
  onSelect,
  optionStatus = "Ready to create an offer",
  robots,
  subtitle = "Ready robots without an active trade",
  title = "With which robot?"
}: {
  addingRobot?: boolean;
  emptyMessage?: string;
  fleetFull?: boolean;
  onAddRobot?: () => void;
  onClose: () => void;
  onSelect: (slotId: string) => void;
  optionStatus?: string;
  robots: OfferReadyRobots;
  subtitle?: string;
  title?: string;
}) {
  return (
    <Dialog
      ariaLabelledby="pro-create-robot-title"
      onClose={onClose}
      overlayClassName="confirm-overlay"
      panelClassName="garage-switcher-panel pro-create-robot-picker"
    >
        <header className="garage-switcher-header">
          <span>
            <h3 id="pro-create-robot-title">{title}</h3>
            <small>{subtitle}</small>
          </span>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close robot selector">
            <X size={18} />
          </button>
        </header>
        {robots.length > 0 ? (
          <div className="garage-switcher-list">
            {robots.map((robot) => (
              <button
                className="garage-switcher-item pro-create-robot-option"
                key={robot.slotId}
                onClick={() => onSelect(robot.slotId)}
                type="button"
              >
                <RobotAvatar hashId={robot.hashId} label={robot.nickname} size="md" />
                <span className="garage-switcher-item-info">
                  <strong className="garage-switcher-item-name">{robot.nickname}</strong>
                  <small className={`garage-switcher-item-status${robot.previouslyUsed ? " pro-reused-robot-status" : ""}`}>
                    {robot.previouslyUsed ? <AlertTriangle size={12} aria-hidden="true" /> : null}
                    {robot.previouslyUsed ? "Ready · previously used identity" : optionStatus}
                  </small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <div className="pro-create-robot-empty">
            <RobotGlyph size={24} />
            <strong>No robot is available</strong>
            <p>{emptyMessage ?? (fleetFull
              ? `All ${GARAGE_LIMITS.activeRobots} Fleet robots are currently unavailable. Finish an order or remove an idle robot before adding another.`
              : "Create a robot here, then use it to publish an offer.")}</p>
            {!fleetFull && onAddRobot ? (
              <Button loading={addingRobot} onClick={onAddRobot} size="sm">
                <RobotGlyph size={16} /> Create robot
              </Button>
            ) : null}
          </div>
        )}
        {robots.some((robot) => robot.previouslyUsed) ? (
          <p className="pro-reused-robot-note">
            Previously used robots remain available, but a fresh robot provides stronger separation between trades.
          </p>
        ) : null}
    </Dialog>
  );
}

export function RobotAddedNotice({
  onClose,
  robot
}: {
  onClose: () => void;
  robot: { hashId: string; nickname: string };
}) {
  return (
    <aside className="pro-robot-added-notice" role="status" aria-live="polite">
      <RobotAvatar hashId={robot.hashId} label={robot.nickname} size="sm" />
      <strong>{robot.nickname} has been added!</strong>
      <button className="icon-button" onClick={onClose} type="button" aria-label="Dismiss robot added message">
        <X size={16} />
      </button>
    </aside>
  );
}

export function TelegramCoordinatorPicker({
  coordinators,
  onClose,
  onSelect,
  slot
}: {
  coordinators: CoordinatorSummary[];
  onClose: () => void;
  onSelect: (botName: string, token: string) => void;
  slot: RobotSlot;
}) {
  const refreshRobotSlot = useGarageStore((state) => state.refreshRobotSlot);
  const [connectingAlias, setConnectingAlias] = useState<string>();
  const [failedAlias, setFailedAlias] = useState<string>();

  async function selectCoordinator(coordinator: CoordinatorSummary) {
    const existing = slot.robots[coordinator.shortAlias];
    if (existing?.tgBotName && existing.tgToken) {
      onSelect(existing.tgBotName, existing.tgToken);
      return;
    }

    setConnectingAlias(coordinator.shortAlias);
    setFailedAlias(undefined);
    try {
      await refreshRobotSlot(slot.token, [coordinator]);
      const refreshedSlot = useGarageStore.getState().slots.find((item) => item.token === slot.token);
      const refreshedRobot = refreshedSlot?.robots[coordinator.shortAlias];
      if (refreshedRobot?.tgBotName && refreshedRobot.tgToken) {
        onSelect(refreshedRobot.tgBotName, refreshedRobot.tgToken);
        return;
      }
      setFailedAlias(coordinator.shortAlias);
    } catch {
      setFailedAlias(coordinator.shortAlias);
    } finally {
      setConnectingAlias(undefined);
    }
  }

  return (
    <Dialog
      ariaLabelledby="pro-telegram-title"
      onClose={onClose}
      overlayClassName="confirm-overlay"
      panelClassName="confirm-sheet pro-telegram-picker"
    >
        <button className="take-modal-close" onClick={onClose} type="button" aria-label="Close Telegram coordinator picker">
          <X size={20} />
        </button>
        <div>
          <h3 id="pro-telegram-title">Choose notification coordinator</h3>
          <p className="muted-copy">Each coordinator operates its own notification bot. Telegram enrollment applies only to the coordinator you choose.</p>
        </div>
        <div className="pro-telegram-coordinator-list">
          {coordinators.map((coordinator) => {
            const robot = slot.robots[coordinator.shortAlias];
            const available = Boolean(robot?.tgBotName && robot.tgToken);
            const connecting = connectingAlias === coordinator.shortAlias;
            const failed = failedAlias === coordinator.shortAlias;
            return (
              <button
                className="pro-telegram-coordinator"
                disabled={Boolean(connectingAlias)}
                key={coordinator.shortAlias}
                onClick={() => void selectCoordinator(coordinator)}
                type="button"
              >
                <img className="coordinator-avatar coordinator-avatar-sm" src={coordinator.smallAvatarUrl} alt="" />
                <span>
                  <strong>{coordinator.longAlias}</strong>
                  <small>{connecting
                    ? "Connecting robot…"
                    : failed
                      ? "Could not connect. Try again"
                      : available
                        ? "Telegram setup available"
                        : "Connect and continue"}</small>
                </span>
                {connecting
                  ? <span className="ui-spinner pro-telegram-connecting" aria-hidden="true" />
                  : <ChevronRight size={17} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <div className="confirm-actions">
          <Button variant="secondary" onClick={onClose}>Back</Button>
        </div>
    </Dialog>
  );
}

export function ConfirmDeleteRobot({
  onCancel,
  onConfirm,
  robotName
}: {
  onCancel: () => void;
  onConfirm: () => void;
  robotName: string;
}) {
  return (
    <Dialog
      ariaLabelledby="pro-delete-robot-title"
      onClose={onCancel}
      overlayClassName="confirm-overlay"
      panelClassName="confirm-sheet"
    >
        <div className="confirm-header">
          <span className="confirm-icon-shell" aria-hidden="true"><AlertTriangle size={22} /></span>
          <h3 id="pro-delete-robot-title">Remove {robotName}?</h3>
        </div>
        <p className="confirm-body">This removes the robot from your Fleet. This action cannot be undone.</p>
        <div className="confirm-actions">
          <Button variant="secondary" onClick={onCancel}>Keep robot</Button>
          <Button variant="destructive" onClick={onConfirm}><Trash2 size={16} /> Remove from Fleet</Button>
        </div>
    </Dialog>
  );
}

export function ConfirmCancelOffer({
  loading,
  onCancel,
  onConfirm,
  orderId
}: {
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  orderId: number;
}) {
  return (
    <Dialog
      ariaLabelledby="pro-cancel-offer-title"
      closeOnEscape={!loading}
      onClose={onCancel}
      overlayClassName="confirm-overlay"
      panelClassName="confirm-sheet"
    >
        <div className="confirm-header">
          <span className="confirm-icon-shell" aria-hidden="true"><AlertTriangle size={22} /></span>
          <h3 id="pro-cancel-offer-title">Cancel order #{orderId}?</h3>
        </div>
        <p className="confirm-body">The offer will be removed from the public order book. This cannot be undone.</p>
        <div className="confirm-actions">
          <Button disabled={loading} variant="secondary" onClick={onCancel}>Keep offer</Button>
          <Button loading={loading} variant="destructive" onClick={onConfirm}><X size={16} /> Cancel offer</Button>
        </div>
    </Dialog>
  );
}
