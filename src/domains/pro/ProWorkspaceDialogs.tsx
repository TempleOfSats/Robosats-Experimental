import { AlertTriangle, Check, ChevronRight, PlusCircle, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
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
  onAddRobot?: () => Promise<string | undefined>;
  onClose: () => void;
  onSelect: (slotId: string) => void;
  optionStatus?: string;
  robots: OfferReadyRobots;
  subtitle?: string;
  title?: string;
}) {
  const [pendingReuse, setPendingReuse] = useState<OfferReadyRobots[number]>();
  const [creatingFresh, setCreatingFresh] = useState(false);
  const freshRobots = robots.filter((robot) => !robot.previouslyUsed);
  const reusedRobots = robots.filter((robot) => robot.previouslyUsed);
  const canCreateFresh = canOfferFreshRobot(onAddRobot, fleetFull, freshRobots.length, reusedRobots.length);
  const orderedRobots = [...freshRobots, ...reusedRobots];
  const freshRobotBusy = addingRobot || creatingFresh;

  async function createFreshRobot() {
    if (!onAddRobot || freshRobotBusy) return;
    setCreatingFresh(true);
    try {
      const slotId = await onAddRobot();
      if (slotId) onSelect(slotId);
    } finally {
      setCreatingFresh(false);
    }
  }

  return (
    <Dialog
      ariaLabelledby="pro-create-robot-title"
      onClose={onClose}
      overlayClassName="confirm-overlay pro-sheet-overlay"
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
        {pendingReuse ? (
          <div className="pro-reuse-confirmation">
            <div className="pro-reuse-robot">
              <RobotAvatar hashId={pendingReuse.hashId} label={pendingReuse.nickname} size="md" />
              <span>
                <small>Reuse robot</small>
                <strong>{pendingReuse.nickname}</strong>
              </span>
            </div>
            <p>A fresh robot provides better separation between trades.</p>
            <div className="pro-reuse-actions">
              <Button variant="secondary" onClick={() => onSelect(pendingReuse.slotId)}>
                Use this robot
              </Button>
              {canCreateFresh ? (
                <Button loading={freshRobotBusy} loadingLabel="Creating fresh robot" onClick={() => void createFreshRobot()}>
                  <PlusCircle size={16} aria-hidden="true" /> Create fresh robot
                </Button>
              ) : (
                <Button onClick={() => setPendingReuse(undefined)}>Back to robots</Button>
              )}
            </div>
          </div>
        ) : robots.length > 0 ? (
          <div className="garage-switcher-list">
            {canCreateFresh ? (
              <button
                className="garage-switcher-item pro-fresh-robot-option"
                aria-busy={freshRobotBusy || undefined}
                disabled={freshRobotBusy}
                onClick={() => void createFreshRobot()}
                type="button"
              >
                <span className="pro-fresh-robot-icon" aria-hidden="true">
                  <PlusCircle size={20} />
                </span>
                <span className="garage-switcher-item-info">
                  <strong className="garage-switcher-item-name">{freshRobotBusy ? "Creating fresh robot…" : "Fresh robot"}</strong>
                  <small className="garage-switcher-item-status">
                    <ShieldCheck size={12} aria-hidden="true" /> New identity · Best privacy
                  </small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ) : null}
            {canCreateFresh ? <p className="pro-robot-list-divider">Or reuse an available robot</p> : null}
            {orderedRobots.map((robot) => (
              <button
                className="garage-switcher-item pro-create-robot-option"
                key={robot.slotId}
                onClick={() => selectRobot(robot, onSelect, setPendingReuse)}
                type="button"
              >
                <RobotAvatar hashId={robot.hashId} label={robot.nickname} size="md" />
                <span className="garage-switcher-item-info">
                  <strong className="garage-switcher-item-name">{robot.nickname}</strong>
                  <small className="garage-switcher-item-status">
                    {robot.previouslyUsed ? "Used before" : optionStatus}
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
              <Button loading={freshRobotBusy} onClick={() => void createFreshRobot()} size="sm">
                <RobotGlyph size={16} /> Create robot
              </Button>
            ) : null}
          </div>
        )}
    </Dialog>
  );
}

function selectRobot(
  robot: OfferReadyRobots[number],
  onSelect: (slotId: string) => void,
  onReuse: (robot: OfferReadyRobots[number]) => void
) {
  if (robot.previouslyUsed) onReuse(robot);
  else onSelect(robot.slotId);
}

function canOfferFreshRobot(
  onAddRobot: (() => Promise<string | undefined>) | undefined,
  fleetFull: boolean,
  freshRobotCount: number,
  reusedRobotCount: number
): boolean {
  return Boolean(onAddRobot && !fleetFull && freshRobotCount === 0 && reusedRobotCount > 0);
}

export function ProActionNotice({
  detail,
  noticeKey,
  onClose,
  robot,
  title
}: {
  detail: string;
  noticeKey: number;
  onClose: () => void;
  robot?: { hashId: string; nickname: string };
  title: string;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onClose, 3_600);
    return () => window.clearTimeout(timeout);
  }, [noticeKey, onClose]);

  return (
    <aside className="action-notice pro-action-notice">
      {robot ? (
        <RobotAvatar hashId={robot.hashId} label={robot.nickname} size="sm" />
      ) : (
        <span className="pro-action-notice-icon" aria-hidden="true"><Check size={17} strokeWidth={2.5} /></span>
      )}
      <span className="action-notice-copy" role="status" aria-atomic="true" aria-live="polite">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <button className="icon-button pro-action-notice-close" onClick={onClose} type="button" aria-label="Dismiss confirmation">
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
