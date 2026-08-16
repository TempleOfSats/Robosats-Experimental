import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Download,
  Hash,
  KeyRound,
  Plus,
  Search,
  Send,
  Settings,
  Trash2,
  Trophy,
  X
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppTransitionDialog, AppTransitionFeedback } from "@/domains/navigation/AppTransitionFeedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { VisualSelect } from "@/components/ui/visualSelect";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { compareCoordinatorsByEstablished } from "@/domains/coordinators/coordinatorOrder";
import type { CoordinatorRating } from "@/domains/coordinators/coordinatorRatings";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import {
  getRobotAuthForCoordinator,
  selectCurrentSlot,
  selectStandardGarageSlots,
  type RobotRecord,
  type RobotSlot,
  useGarageStore
} from "@/domains/garage/garageStore";
import { requestRobotDataRefresh } from "@/domains/garage/robotDataRefresh";
import { isProFleetToken } from "@/domains/garage/token";
import { CreateRobotPanel } from "@/domains/garage/CreateRobotPanel";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { ingestCoordinatorOrder } from "@/domains/orders/orderActivity";
import { fetchOrder } from "@/domains/orders/orderApi";
import { disputeOutcomeForCurrentRobot } from "@/domains/orders/orderStateMachine";
import type { OrderDto } from "@/domains/orders/order.types";
import { currencyIdFromCode, currencyOptions } from "@/domains/orderbook/currencies";
import type { GuidedTradeCriteria } from "@/domains/orderbook/guidedTrade";
import { useOrderbookStore } from "@/domains/orderbook/orderbookStore";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { CurrencyFlag, PaymentMethodIcons } from "@/domains/orderbook/OfferMeta";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import { formatFiat, formatSats } from "@/lib/format";
import { playHaptic } from "@/lib/haptics";
import { toUserMessage } from "@/lib/userError";

const RobotKeysDialog = lazy(() =>
  import("@/domains/garage/RobotKeysDialog").then((module) => ({ default: module.RobotKeysDialog }))
);
const LazyBeginnerTradeWizard = lazy(() =>
  import("@/domains/orderbook/BeginnerTradeWizard").then((module) => ({ default: module.BeginnerTradeWizard }))
);
const LazyCoordinatorDetailDialog = lazy(() =>
  import("@/domains/coordinators/CoordinatorsPage").then((module) => ({ default: module.CoordinatorDetailDialog }))
);
const LazyRewardWithdrawalDialog = lazy(() =>
  import("@/domains/rewards/RewardWithdrawalDialog").then((module) => ({ default: module.RewardWithdrawalDialog }))
);
const LazyRobotTokenBackupDialog = lazy(() =>
  import("@/domains/garage/RobotTokenBackupDialog").then((module) => ({ default: module.RobotTokenBackupDialog }))
);
const LazyTelegramSetupDialog = lazy(() =>
  import("@/domains/garage/TelegramSetupDialog").then((module) => ({ default: module.TelegramSetupDialog }))
);
const LazyGarageRecoveryDialog = lazy(() =>
  import("@/domains/pro/GarageRecoveryDialog").then((module) => ({ default: module.GarageRecoveryDialog }))
);

function robotSetupIntroduction(hasExistingRobot: boolean) {
  return hasExistingRobot
    ? {
        eyebrow: "Garage",
        title: "Add another robot",
        description: "Create a separate trading identity, or restore one with its recovery token."
      }
    : {
        eyebrow: "Private Lightning exchange",
        title: "Welcome to RoboSats",
        description:
          "Trade bitcoin peer to peer over Lightning. RoboSats is simple and private—no email or account registration is needed."
      };
}

export function RobotGaragePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const allSlots = useGarageStore((state) => state.slots);
  const slots = selectStandardGarageSlots(allSlots);
  const currentToken = useGarageStore((state) => state.currentToken);
  const hydrated = useGarageStore((state) => state.hydrated);
  const hydrate = useGarageStore((state) => state.hydrate);
  const setCurrentToken = useGarageStore((state) => state.setCurrentToken);
  const addSlot = useGarageStore((state) => state.addSlot);
  const updateSlotIdentityDetails = useGarageStore((state) => state.updateSlotIdentityDetails);
  const removeSlot = useGarageStore((state) => state.removeSlot);
  const coordinators = useFederationStore((state) => state.coordinators);
  const activeSlot = selectCurrentSlot(slots, currentToken);
  const displayCoordinators = coordinators
    .filter((coordinator) => coordinator.shortAlias !== "local")
    .sort(compareCoordinatorsByEstablished);
  const [showFirstRunWizard, setShowFirstRunWizard] = useState(false);
  const [showRobotSwitcher, setShowRobotSwitcher] = useState(false);
  const [showRobotSettings, setShowRobotSettings] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [showSettingsTokenBackup, setShowSettingsTokenBackup] = useState(false);
  const [showLastOrder, setShowLastOrder] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [fleetKeyCandidate, setFleetKeyCandidate] = useState<string>();
  const [fleetRecoveryKey, setFleetRecoveryKey] = useState<string>();
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [removingRobot, setRemovingRobot] = useState(false);
  const [selectedAlias, setSelectedAlias] = useState<string | undefined>();
  const [showGuidedTrade, setShowGuidedTrade] = useState(false);
  const selectedCoordinator = displayCoordinators.find((coordinator) => coordinator.shortAlias === selectedAlias);
  const selectedRobot =
    selectedCoordinator && activeSlot ? activeSlot.robots[selectedCoordinator.shortAlias] : undefined;
  const checkingExistingOrders = Boolean(
    activeSlot?.loading || Object.values(activeSlot?.robots ?? {}).some((robot) => robot.loading)
  );
  const guidedOrders = useOrderbookStore((state) => state.orders);
  const guidedOrdersLoading = useOrderbookStore((state) => state.loading);
  const guidedOrdersRefreshing = useOrderbookStore((state) => state.refreshing);
  const refreshOrderbook = useOrderbookStore((state) => state.refreshOrderbook);
  const setProEnabled = useProPreferencesStore((state) => state.setEnabled);
  const markProSetupSeen = useProPreferencesStore((state) => state.markSetupSeen);
  const setProLastView = useProPreferencesStore((state) => state.setLastView);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && slots.length === 0) {
      setShowFirstRunWizard(true);
    }
  }, [hydrated, slots.length]);

  useEffect(() => {
    if (hydrated && searchParams.get("add") === "1") {
      setShowFirstRunWizard(true);
    }
  }, [hydrated, searchParams]);

  const removeRobotFromGarage = async (slot: RobotSlot) => {
    setRemovingRobot(true);
    setRemoveError("");
    try {
      removeSlot(slot.token);
      setShowDeleteConfirmation(false);
    } catch (error) {
      setRemoveError(toUserMessage(error, "Could not remove this robot."));
    } finally {
      setRemovingRobot(false);
    }
  };

  function openGuidedTrade() {
    setShowGuidedTrade(true);
    void refreshGuidedOrders();
  }

  async function refreshGuidedOrders() {
    let federation = useFederationStore.getState();
    if (federation.connection !== "nostr") {
      await federation.refreshCoordinators();
      federation = useFederationStore.getState();
    }
    await refreshOrderbook(federation.coordinators, {
      connection: federation.connection,
      hostUrl: typeof window === "undefined" ? "" : window.location.host,
      network: federation.network,
      origin: federation.origin
    });
  }

  function createGuidedOffer(criteria: GuidedTradeCriteria) {
    setShowGuidedTrade(false);
    navigate("/create", {
      state: {
        prefillDraft: {
          type: criteria.intent === "buy" ? 0 : 1,
          currency: currencyIdFromCode(criteria.currency),
          amount: String(criteria.amount),
          paymentMethod: criteria.paymentMethod
        }
      }
    });
  }

  function reviewGuidedOffer(order: PublicOrder, criteria: GuidedTradeCriteria) {
    navigate("/offers", {
      state: {
        guidedTradeLaunch: {
          criteria,
          returnTo: "/garage",
          reviewOrder: order
        }
      }
    });
  }

  function offerFleetRecovery(fleetKey: string) {
    setShowRecovery(false);
    setFleetKeyCandidate(fleetKey);
  }

  function closeRobotSettings() {
    setShowRobotSettings(false);
    setShowKeys(false);
    setSelectedAlias(undefined);
  }

  const fleetRecoveryDialogs = (
    <FleetRecoveryDialogs
      candidate={fleetKeyCandidate}
      recoveryKey={fleetRecoveryKey}
      onCancelCandidate={() => setFleetKeyCandidate(undefined)}
      onConfirmCandidate={() => {
        setFleetRecoveryKey(fleetKeyCandidate);
        setFleetKeyCandidate(undefined);
      }}
      onCloseRecovery={() => setFleetRecoveryKey(undefined)}
      onRestored={() => {
        markProSetupSeen();
        setProLastView("robots");
        setProEnabled(true);
        navigate("/pro");
      }}
    />
  );

  if (!hydrated) {
    return (
      <main className="page page-narrow garage-page">
        <AppTransitionFeedback title="Preparing your robot" message="Restoring its private identity..." />
      </main>
    );
  }

  if (slots.length === 0 || showFirstRunWizard) {
    const introduction = robotSetupIntroduction(slots.length > 0);
    return (
      <main className="page page-narrow garage-page garage-setup-page">
        <div className="page-heading">
          <div>
            <p className="app-eyebrow">{introduction.eyebrow}</p>
            <h2>{introduction.title}</h2>
            <p>{introduction.description}</p>
          </div>
          {slots.length > 0 ? (
            <button
              aria-label="Back to Garage"
              className="icon-button garage-setup-exit"
              onClick={() => setShowFirstRunWizard(false)}
              type="button"
            >
              <X size={18} />
            </button>
          ) : null}
        </div>
        <div className="start-card start-card-unframed">
          <CreateRobotPanel onFleetRecovery={offerFleetRecovery} onProfile={() => setShowFirstRunWizard(false)} />
        </div>
        {fleetRecoveryDialogs}
      </main>
    );
  }

  if (!activeSlot) {
    return (
      <main className="page page-narrow garage-page">
        <AppTransitionFeedback title="Preparing your robot" message="Restoring its private identity..." />
      </main>
    );
  }

  return (
    <main className="page page-narrow garage-page">
      <div className="garage-profile-stage">
        <Card className="garage-robot-hero">
          <button
            aria-label={`Switch robot. Current robot: ${activeSlot.nickname}`}
            className="garage-robot-picker"
            onClick={() => setShowRobotSwitcher(true)}
            type="button"
          >
            <span className="garage-robot-name">
              <strong>{activeSlot.nickname}</strong>
              <small>
                Switch robot <ChevronDown size={14} aria-hidden="true" />
              </small>
            </span>
            <span className="garage-robot-avatar-shell">
              <RobotAvatar hashId={activeSlot.hashId} label={activeSlot.nickname} size="xl" />
            </span>
          </button>

          <GarageOperationalState
            checking={checkingExistingOrders}
            onLastOrder={() => setShowLastOrder(true)}
            slot={activeSlot}
          />
          <GarageRewardClaim coordinators={displayCoordinators} slot={activeSlot} />

          <div className="garage-robot-actions" aria-label="Robot controls" role="group">
            <button aria-label="Backup robot token" type="button" onClick={() => setShowSettingsTokenBackup(true)}>
              <Download size={16} aria-hidden="true" />
              <span>Backup</span>
            </button>
            <button aria-label="Add another robot" type="button" onClick={() => setShowFirstRunWizard(true)}>
              <Plus size={16} aria-hidden="true" />
              <span>Add</span>
            </button>
            <button aria-label="Recover a robot" type="button" onClick={() => setShowRecovery(true)}>
              <KeyRound size={16} aria-hidden="true" />
              <span>Recover</span>
            </button>
            <button aria-label="Manage robot" type="button" onClick={() => setShowRobotSettings(true)}>
              <Settings size={16} aria-hidden="true" />
              <span>Manage</span>
            </button>
          </div>
        </Card>

        {activeSlot.activeOrderId ? (
          <Link className="garage-continue-trade" to={orderPath(activeSlot, activeSlot.activeOrderId)}>
            <span>
              <strong>Continue trade</strong>
              <small>Order #{activeSlot.activeOrderId} is in progress</small>
            </span>
            <ArrowRight size={20} aria-hidden="true" />
          </Link>
        ) : (
          <div className="next-action-grid">
            <button
              className="action-tile action-tile-primary garage-guided-trade-action"
              onClick={openGuidedTrade}
              type="button"
            >
              <Search size={20} />
              <strong>Find an offer</strong>
              <span>Guided matching</span>
              <ArrowRight className="action-tile-arrow" size={17} aria-hidden="true" />
            </button>
            <Link className="action-tile action-tile-secondary" to="/create">
              <Plus size={20} />
              <strong>Create an offer</strong>
              <span>Set your own terms</span>
            </Link>
          </div>
        )}
      </div>

      {showGuidedTrade ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              message="Loading the guided trade steps..."
              onClose={() => setShowGuidedTrade(false)}
              title="Preparing trade finder"
            />
          }
        >
          <LazyBeginnerTradeWizard
            coordinators={displayCoordinators}
            loading={(guidedOrdersLoading || guidedOrdersRefreshing) && guidedOrders.length === 0}
            onClose={() => setShowGuidedTrade(false)}
            onCreateOffer={createGuidedOffer}
            onSelectOffer={reviewGuidedOffer}
            orders={guidedOrders}
          />
        </Suspense>
      ) : null}

      {showRobotSwitcher ? (
        <RobotSwitcher
          activeToken={activeSlot.token}
          onClose={() => setShowRobotSwitcher(false)}
          onSelect={(token) => {
            setCurrentToken(token);
            setShowRobotSwitcher(false);
          }}
          slots={slots}
        />
      ) : null}

      {showLastOrder && activeSlot.lastOrderId ? (
        <LatestOrderDialog
          coordinators={displayCoordinators}
          onClose={() => setShowLastOrder(false)}
          orderId={activeSlot.lastOrderId}
          slot={activeSlot}
        />
      ) : null}

      {showRecovery ? (
        <RobotRecoveryDialog
          onClose={() => setShowRecovery(false)}
          onFleetRecovery={offerFleetRecovery}
          onRecover={(token) => {
            recoverRobotToken(token, addSlot, updateSlotIdentityDetails);
            playHaptic("success");
            setShowRecovery(false);
            requestRobotDataRefresh();
          }}
        />
      ) : null}

      {fleetRecoveryDialogs}

      {showDeleteConfirmation ? (
        <Dialog
          ariaLabelledby="delete-robot-title"
          closeOnEscape={!removingRobot}
          onClose={() => {
            if (!removingRobot) setShowDeleteConfirmation(false);
          }}
          overlayClassName="confirm-overlay"
          panelClassName="confirm-sheet"
        >
          <div className="confirm-header">
            <span className="confirm-icon-shell" aria-hidden="true">
              <AlertTriangle size={24} />
            </span>
            <h3 id="delete-robot-title">Remove {activeSlot.nickname}?</h3>
          </div>
          <p className="confirm-body">This removes the robot from your Garage. This cannot be undone.</p>
          {removeError ? (
            <p className="field-error" role="alert">
              {removeError}
            </p>
          ) : null}
          <div className="confirm-actions">
            <Button
              variant="secondary"
              type="button"
              disabled={removingRobot}
              onClick={() => setShowDeleteConfirmation(false)}
            >
              Keep robot
            </Button>
            <Button
              variant="destructive"
              type="button"
              loading={removingRobot}
              onClick={() => void removeRobotFromGarage(activeSlot)}
            >
              <Trash2 size={16} />
              Remove from Garage
            </Button>
          </div>
        </Dialog>
      ) : null}

      {showRobotSettings ? (
        <RobotSettingsDialog
          activeToken={activeSlot.token}
          coordinators={displayCoordinators}
          onAddRobot={() => {
            closeRobotSettings();
            setShowFirstRunWizard(true);
          }}
          onClose={closeRobotSettings}
          onCoordinatorSelect={setSelectedAlias}
          onRecoverRobot={() => {
            closeRobotSettings();
            setShowRecovery(true);
          }}
          onRemoveRobot={() => {
            closeRobotSettings();
            setRemoveError("");
            setShowDeleteConfirmation(true);
          }}
          onTokenBackup={() => setShowSettingsTokenBackup(true)}
          onTokenChange={setCurrentToken}
          selectedAlias={selectedAlias}
          showKeys={showKeys}
          slot={activeSlot}
          slots={slots}
          toggleKeys={() => setShowKeys((open) => !open)}
        />
      ) : null}

      {showSettingsTokenBackup ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              message="Loading the local backup controls..."
              onClose={() => setShowSettingsTokenBackup(false)}
              title="Preparing token backup"
            />
          }
        >
          <LazyRobotTokenBackupDialog
            onClose={() => setShowSettingsTokenBackup(false)}
            robotName={activeSlot.nickname}
            token={activeSlot.token}
          />
        </Suspense>
      ) : null}

      {selectedCoordinator && showRobotSettings ? (
        <RobotCoordinatorDialog
          coordinator={selectedCoordinator}
          robot={selectedRobot}
          slot={activeSlot}
          onClose={() => setSelectedAlias(undefined)}
        />
      ) : null}
    </main>
  );
}

function FleetRecoveryDialogs({
  candidate,
  recoveryKey,
  onCancelCandidate,
  onConfirmCandidate,
  onCloseRecovery,
  onRestored
}: {
  candidate?: string;
  recoveryKey?: string;
  onCancelCandidate: () => void;
  onConfirmCandidate: () => void;
  onCloseRecovery: () => void;
  onRestored: () => void;
}) {
  return (
    <>
      {candidate ? (
        <FleetRecoveryConfirmationDialog onCancel={onCancelCandidate} onConfirm={onConfirmCandidate} />
      ) : null}
      {recoveryKey ? (
        <Suspense
          fallback={
            <AppTransitionDialog title="Preparing Fleet restore" message="Opening the private recovery tool..." />
          }
        >
          <LazyGarageRecoveryDialog initialFleetKey={recoveryKey} onClose={onCloseRecovery} onRestored={onRestored} />
        </Suspense>
      ) : null}
    </>
  );
}

function GarageOperationalState({
  checking,
  onLastOrder,
  slot
}: {
  checking: boolean;
  onLastOrder: () => void;
  slot: RobotSlot;
}) {
  const releasedOrderId = Object.values(slot.robots).find((robot) => robot.releasedOrderId)?.releasedOrderId;

  if (slot.activeOrderId) {
    return (
      <div className="garage-operational-state garage-operational-state-active">
        <span aria-live="polite" role="status">
          <strong>Trade in progress</strong>
          <small>Order #{slot.activeOrderId}</small>
        </span>
      </div>
    );
  }

  const hasLastOrder = Boolean(slot.lastOrderId);

  return (
    <div className="garage-operational-state">
      <span aria-live={hasLastOrder ? undefined : "polite"} role={hasLastOrder ? undefined : "status"}>
        <strong aria-live={hasLastOrder ? "polite" : undefined} role={hasLastOrder ? "status" : undefined}>
          Ready to trade
        </strong>
        {slot.lastOrderId ? (
          <button type="button" onClick={onLastOrder}>
            No active orders · Last order #{slot.lastOrderId}
          </button>
        ) : releasedOrderId ? (
          <small>No active orders · Last seen #{releasedOrderId}</small>
        ) : checking ? (
          <small>No active orders · Checking coordinators…</small>
        ) : (
          <small>No active orders</small>
        )}
      </span>
    </div>
  );
}

function GarageRewardClaim({ coordinators, slot }: { coordinators: CoordinatorSummary[]; slot: RobotSlot }) {
  const [open, setOpen] = useState(false);
  const rewardsAvailable = slot.earnedRewards > 0;
  if (!rewardsAvailable && !open) return null;
  return (
    <>
      {rewardsAvailable ? (
        <button className="garage-reward-status" onClick={() => setOpen(true)} type="button">
          <Trophy size={15} aria-hidden="true" />
          {formatSats(slot.earnedRewards)} ready to claim
        </button>
      ) : null}
      {open ? (
        <Suspense fallback={<AppTransitionDialog title="Preparing rewards" message="Loading the claim controls..." />}>
          <LazyRewardWithdrawalDialog coordinators={coordinators} onClose={() => setOpen(false)} slot={slot} />
        </Suspense>
      ) : null}
    </>
  );
}

function RobotRecoveryDialog({
  onClose,
  onFleetRecovery,
  onRecover
}: {
  onClose: () => void;
  onFleetRecovery: (fleetKey: string) => void;
  onRecover: (token: string) => void;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const cleanToken = token.trim();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cleanToken) {
      setError("Paste your robot token first.");
      return;
    }
    if (cleanToken.length < 16) {
      setError("This token is too short to be a RoboSats robot token.");
      return;
    }
    if (isProFleetToken(cleanToken)) {
      onFleetRecovery(cleanToken);
      return;
    }
    onRecover(cleanToken);
  };

  return (
    <Dialog
      ariaLabelledby="robot-recovery-title"
      onClose={onClose}
      overlayClassName="garage-switcher-overlay"
      panelClassName="garage-recovery-dialog"
    >
      <header>
        <div className="garage-recovery-heading">
          <span className="garage-recovery-icon" aria-hidden="true">
            <KeyRound size={20} />
          </span>
          <div>
            <h3 id="robot-recovery-title">Recover a robot</h3>
            <p>Use the token you saved when this robot was created.</p>
          </div>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close recovery">
          <X size={18} />
        </button>
      </header>
      <form onSubmit={submit}>
        <label className="garage-recovery-field">
          <span>Robot token</span>
          <textarea
            aria-describedby={error ? "robot-recovery-error" : undefined}
            aria-invalid={Boolean(error)}
            autoFocus
            autoCapitalize="none"
            autoComplete="off"
            onChange={(event) => {
              setToken(event.target.value);
              setError("");
            }}
            placeholder="Paste your token"
            rows={3}
            spellCheck={false}
            value={token}
          />
        </label>
        {error ? (
          <p className="field-error" id="robot-recovery-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="garage-recovery-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!cleanToken}>
            <KeyRound size={16} />
            Recover robot
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function FleetRecoveryConfirmationDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog
      ariaLabelledby="fleet-recovery-confirmation-title"
      onClose={onCancel}
      overlayClassName="confirm-overlay"
      panelClassName="confirm-sheet"
    >
      <div className="confirm-header">
        <span className="confirm-icon-shell" aria-hidden="true">
          <KeyRound size={24} />
        </span>
        <h3 id="fleet-recovery-confirmation-title">Restore a Pro Robot Fleet?</h3>
      </div>
      <p className="confirm-body">
        This is a Pro Mode Robot Fleet key, not a single-robot token. Continue to restore its synced robots, then open
        them in Pro Mode.
      </p>
      <div className="confirm-actions">
        <Button variant="secondary" type="button" onClick={onCancel}>
          Stay in Garage
        </Button>
        <Button type="button" onClick={onConfirm}>
          Continue to Fleet recovery
        </Button>
      </div>
    </Dialog>
  );
}

function recoverRobotToken(
  token: string,
  addSlot: ReturnType<typeof useGarageStore.getState>["addSlot"],
  updateSlotIdentityDetails: ReturnType<typeof useGarageStore.getState>["updateSlotIdentityDetails"]
): void {
  const identity = deriveRobotIdentity(token);
  const fallbackName = `Robot ${identity.hashId.slice(0, 8)}`;
  addSlot({
    ...identity,
    nickname: fallbackName,
    managedBy: undefined,
    earnedRewards: 0,
    robots: {
      local: {
        token,
        shortAlias: "local",
        nostrPubKey: identity.nostrPubKey,
        tokenSHA256: identity.tokenSHA256,
        earnedRewards: 0
      }
    }
  });

  void import("@/domains/identity/roboavatarClient")
    .then(({ prewarmRobotAvatar }) => prewarmRobotAvatar(identity.hashId))
    .catch(() => undefined);

  void import("@/domains/identity/robonameClient")
    .then(({ generateRoboname }) => {
      updateSlotIdentityDetails(token, { nickname: generateRoboname(identity.hashId) });
    })
    .catch(() => undefined);

  void import("@/domains/crypto/pgp")
    .then(({ generatePgpKeyPair }) => generatePgpKeyPair(token))
    .then((keyPair) =>
      updateSlotIdentityDetails(token, {
        keys: {
          pubKey: keyPair.publicKeyArmored,
          encPrivKey: keyPair.encryptedPrivateKeyArmored
        }
      })
    )
    .catch(() => undefined);
}

export function RobotSettingsDialog({
  activeToken,
  coordinators,
  onAddRobot,
  onClose,
  onCoordinatorSelect,
  onRecoverRobot,
  onRemoveRobot,
  onTokenBackup,
  onTokenChange,
  showKeys,
  slot,
  slots,
  toggleKeys
}: {
  activeToken: string;
  coordinators: CoordinatorSummary[];
  onAddRobot?: () => void;
  onClose: () => void;
  onCoordinatorSelect: (shortAlias: string) => void;
  onRecoverRobot?: () => void;
  onRemoveRobot?: () => void;
  onTokenBackup: () => void;
  onTokenChange: (token: string) => void;
  selectedAlias?: string;
  showKeys: boolean;
  slot: NonNullable<ReturnType<typeof selectCurrentSlot>>;
  slots: Array<NonNullable<ReturnType<typeof selectCurrentSlot>>>;
  toggleKeys: () => void;
}) {
  return (
    <Dialog
      ariaLabelledby="robot-settings-title"
      onClose={onClose}
      overlayClassName="garage-settings-overlay"
      panelClassName="garage-settings-panel garage-settings-dialog"
    >
      <button className="take-modal-close" onClick={onClose} type="button" aria-label="Close robot settings">
        <X size={20} />
      </button>

      <h2 id="robot-settings-title">Your Robot</h2>

      <VisualSelect
        ariaLabel="Select robot"
        className="garage-robot-select"
        onChange={onTokenChange}
        options={slots.map((item) => ({
          value: item.token,
          label: item.nickname,
          description: slotOrderStatus(item),
          icon: <RobotAvatar hashId={item.hashId} label={item.nickname} size="md" />
        }))}
        value={activeToken}
      />

      <div className="garage-settings-security-actions">
        <Button className="garage-security-button" type="button" variant="secondary" onClick={onTokenBackup}>
          <Download size={18} />
          Token backup
        </Button>
        <Button
          className="garage-security-button garage-keys-button"
          type="button"
          variant="secondary"
          onClick={toggleKeys}
        >
          <KeyRound size={18} />
          PGP / NOSTR keys
        </Button>
      </div>

      {showKeys ? (
        <Suspense
          fallback={
            <AppTransitionFeedback compact title="Preparing robot keys" message="Loading local credentials..." />
          }
        >
          <RobotKeysDialog slot={slot} onClose={toggleKeys} />
        </Suspense>
      ) : null}

      <section className="garage-known-coordinators">
        <h3>Coordinators that know your robot:</h3>
        <div className="garage-known-list">
          {coordinators.map((coordinator) => (
            <button
              className="garage-known-row"
              key={coordinator.shortAlias}
              type="button"
              aria-label={`Open ${coordinator.longAlias}: ${coordinatorStatus(slot.robots[coordinator.shortAlias])}`}
              onClick={() => onCoordinatorSelect(coordinator.shortAlias)}
            >
              <img className="coordinator-avatar coordinator-avatar-lg" src={coordinator.avatarUrl} alt="" />
              <span>
                <strong>{coordinator.longAlias}</strong>
                <small>{coordinatorStatus(slot.robots[coordinator.shortAlias])}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      {onAddRobot || onRecoverRobot || onRemoveRobot ? (
        <section className="garage-settings-management">
          <h3>Robot management</h3>
          <div className="garage-settings-management-actions">
            {onAddRobot ? (
              <Button type="button" variant="secondary" onClick={onAddRobot}>
                <Plus size={17} />
                Add robot
              </Button>
            ) : null}
            {onRecoverRobot ? (
              <Button type="button" variant="secondary" onClick={onRecoverRobot}>
                <KeyRound size={17} />
                Recover from token
              </Button>
            ) : null}
            {onRemoveRobot ? (
              <Button className="garage-settings-remove" type="button" variant="ghost" onClick={onRemoveRobot}>
                <Trash2 size={17} />
                Remove this robot
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </Dialog>
  );
}

function RobotSwitcher({
  activeToken,
  onClose,
  onSelect,
  slots
}: {
  activeToken: string;
  onClose: () => void;
  onSelect: (token: string) => void;
  slots: Array<NonNullable<ReturnType<typeof selectCurrentSlot>>>;
}) {
  return (
    <Dialog
      ariaLabelledby="robot-switcher-title"
      onClose={onClose}
      overlayClassName="garage-switcher-overlay"
      panelClassName="garage-switcher-panel"
    >
      <div className="garage-switcher-header">
        <h3 id="robot-switcher-title">Select robot</h3>
        <button className="icon-button" onClick={onClose} type="button" aria-label="Close robot switcher">
          <X size={18} />
        </button>
      </div>
      <div className="garage-switcher-list">
        {slots.map((slot) => (
          <button
            key={slot.token}
            className={`garage-switcher-item ${slot.token === activeToken ? "active" : ""}`}
            onClick={() => {
              if (slot.token !== activeToken) playHaptic("selection");
              onSelect(slot.token);
            }}
            type="button"
          >
            <RobotAvatar hashId={slot.hashId} label={slot.nickname} size="md" />
            <div className="garage-switcher-item-info">
              <span className="garage-switcher-item-name">{slot.nickname}</span>
              <span className="garage-switcher-item-status">{slotOrderStatus(slot)}</span>
            </div>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export function RobotCoordinatorDialog({
  coordinator,
  onClose,
  robot,
  slot
}: {
  coordinator: CoordinatorSummary;
  onClose: () => void;
  robot?: RobotRecord;
  slot: NonNullable<ReturnType<typeof selectCurrentSlot>>;
}) {
  const activeOrderText = robot?.activeOrderId ? `Active order #${robot.activeOrderId}` : "No active orders";
  const previousOrderText = robot?.lastOrderId
    ? `Previous order #${robot.lastOrderId}`
    : "You do not have previous orders";
  const rewards = robot?.earnedRewards ?? 0;
  const canSetUpTelegram = Boolean(robot?.tgBotName && robot.tgToken);
  const [showTelegramSetup, setShowTelegramSetup] = useState(false);
  const [showRewardWithdrawal, setShowRewardWithdrawal] = useState(false);
  const [showCoordinatorDetails, setShowCoordinatorDetails] = useState(false);
  const [coordinatorRating, setCoordinatorRating] = useState<CoordinatorRating>({ score: 0, count: 0 });
  const network = useFederationStore((state) => state.network);
  const lastRefreshed = useFederationStore((state) => state.lastRefreshed);

  function openCoordinatorDetails() {
    setShowCoordinatorDetails(true);
    void import("@/domains/coordinators/coordinatorRatings")
      .then(({ fetchCoordinatorRatings }) => fetchCoordinatorRatings([coordinator]))
      .then((ratings) => setCoordinatorRating(ratings[coordinator.shortAlias] ?? { score: 0, count: 0 }))
      .catch(() => setCoordinatorRating({ score: 0, count: 0 }));
  }

  return (
    <>
      <Dialog
        ariaLabelledby="coordinator-robot-title"
        onClose={onClose}
        overlayClassName="garage-robot-dialog-overlay"
        panelClassName="garage-robot-dialog"
      >
        <button
          className="take-modal-close"
          onClick={onClose}
          type="button"
          aria-label="Close coordinator robot details"
        >
          <X size={20} />
        </button>
        <header>
          <button
            className="coordinator-avatar-button"
            type="button"
            aria-label={`View ${coordinator.longAlias} details`}
            onClick={openCoordinatorDetails}
          >
            <img className="coordinator-avatar coordinator-avatar-sm" src={coordinator.smallAvatarUrl} alt="" />
          </button>
          <h2 id="coordinator-robot-title">{coordinator.longAlias}</h2>
        </header>

        <div className="garage-dialog-row">
          <Hash size={22} />
          <span>
            <strong>{activeOrderText}</strong>
            <small>{previousOrderText}</small>
          </span>
        </div>

        {canSetUpTelegram ? (
          <button className="garage-dialog-command" onClick={() => setShowTelegramSetup(true)} type="button">
            <Send size={22} />
            Enable Telegram Notifications
          </button>
        ) : (
          <button
            className="garage-dialog-command"
            disabled
            title="Telegram setup token is not available for this robot."
            type="button"
          >
            <Send size={22} />
            Enable Telegram Notifications
          </button>
        )}

        <div className="garage-dialog-row garage-compensation-row">
          <Trophy size={22} />
          <span>
            <strong>{rewards.toLocaleString()} Sats</strong>
            <small>Your compensations</small>
          </span>
          <Button disabled={rewards <= 0} onClick={() => setShowRewardWithdrawal(true)} size="sm" type="button">
            Claim
          </Button>
        </div>

        <Button className="garage-dialog-back" type="button" variant="ghost" onClick={onClose}>
          Back
        </Button>
      </Dialog>

      {showTelegramSetup && robot?.tgBotName && robot.tgToken ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              message="Loading the notification setup..."
              onClose={() => setShowTelegramSetup(false)}
              title="Preparing Telegram"
            />
          }
        >
          <LazyTelegramSetupDialog
            botName={robot.tgBotName}
            token={robot.tgToken}
            onClose={() => setShowTelegramSetup(false)}
          />
        </Suspense>
      ) : null}

      {showCoordinatorDetails ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              message={`Loading ${coordinator.longAlias}...`}
              onClose={() => setShowCoordinatorDetails(false)}
              title="Preparing coordinator details"
            />
          }
        >
          <LazyCoordinatorDetailDialog
            compact
            coordinator={coordinator}
            lastRefreshed={lastRefreshed}
            network={network}
            rating={coordinatorRating}
            onClose={() => setShowCoordinatorDetails(false)}
          />
        </Suspense>
      ) : null}

      {showRewardWithdrawal ? (
        <Suspense fallback={<AppTransitionDialog title="Preparing rewards" message="Loading the claim controls..." />}>
          <LazyRewardWithdrawalDialog
            coordinators={[coordinator]}
            onClose={() => setShowRewardWithdrawal(false)}
            slot={slot}
          />
        </Suspense>
      ) : null}
    </>
  );
}

function LatestOrderDialog({
  coordinators,
  onClose,
  orderId,
  slot
}: {
  coordinators: CoordinatorSummary[];
  onClose: () => void;
  orderId: number;
  slot: NonNullable<ReturnType<typeof selectCurrentSlot>>;
}) {
  const robot = Object.values(slot.robots).find((item) => item.lastOrderId === orderId);
  const coordinator = coordinators.find((item) => item.shortAlias === robot?.shortAlias);
  const [order, setOrder] = useState<OrderDto>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!coordinator || !robot?.shortAlias) {
      setError("The coordinator for this order is no longer available.");
      return;
    }
    const auth = getRobotAuthForCoordinator(slot, robot.shortAlias);
    if (!auth) {
      setError("Robot credentials for this order are unavailable.");
      return;
    }
    let disposed = false;
    void fetchOrder(coordinator.url, orderId, auth)
      .then((value) => {
        if (disposed) return;
        setOrder(
          ingestCoordinatorOrder({
            order: value,
            orderId,
            shortAlias: robot.shortAlias!,
            slot
          })
        );
      })
      .catch((reason) => {
        if (!disposed) setError(toUserMessage(reason, "Could not load the order."));
      });
    return () => {
      disposed = true;
    };
  }, [coordinator, orderId, robot?.shortAlias, slot]);

  const currency =
    currencyOptions().find((item) => item.code === order?.currency)?.label ?? String(order?.currency ?? "");
  const amount =
    order?.currency === 1000
      ? `Approx. ${formatSats(order.satoshis)}`
      : order
        ? formatFiat(order.amount, currency)
        : "";

  return (
    <Dialog
      ariaLabelledby="last-order-title"
      onClose={onClose}
      overlayClassName="garage-switcher-overlay"
      panelClassName="garage-last-order-dialog"
    >
      <header>
        <div>
          <span className="app-eyebrow">Last order</span>
          <h3 id="last-order-title">Order #{orderId}</h3>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close order details">
          <X size={18} />
        </button>
      </header>
      {coordinator ? (
        <div className="garage-last-order-host">
          <img className="coordinator-avatar coordinator-avatar-sm" src={coordinator.smallAvatarUrl} alt="" />
          <span>
            <strong>{coordinator.longAlias}</strong>
            <small>Order host</small>
          </span>
        </div>
      ) : null}
      {!order && !error ? (
        <div className="garage-last-order-loading" role="status" aria-live="polite">
          <span className="ui-spinner" aria-hidden="true" />
          <span>Loading order details...</span>
        </div>
      ) : null}
      {error ? <p className="status-panel status-panel-warning">{error}</p> : null}
      {order ? (
        <dl className="garage-last-order-summary">
          <div>
            <dt>Status</dt>
            <dd>{orderStatusLabel(order)}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>
              <CurrencyFlag code={currency} size={18} /> {amount}
            </dd>
          </div>
          <div>
            <dt>Method</dt>
            <dd>
              <PaymentMethodIcons text={order.payment_method} size={18} /> {order.payment_method}
            </dd>
          </div>
          <div>
            <dt>Premium</dt>
            <dd>{order.premium.toFixed(2)}%</dd>
          </div>
        </dl>
      ) : null}
      <Button type="button" variant="secondary" onClick={onClose}>
        Close
      </Button>
    </Dialog>
  );
}

function orderPath(slot: NonNullable<ReturnType<typeof selectCurrentSlot>>, orderId: number): string {
  const robot = Object.values(slot.robots).find(
    (item) => item.activeOrderId === orderId || item.lastOrderId === orderId
  );
  return `/order/${robot?.shortAlias ?? "local"}/${orderId}`;
}

function orderStatusLabel(order: OrderDto): string {
  if (order.status === 14) return "Completed";
  if (order.status === 4) return "Cancelled";
  if (order.status === 5) return "Expired";
  if (order.status === 12) return "Cancelled together";
  const disputeOutcome = disputeOutcomeForCurrentRobot(order);
  if (disputeOutcome) return disputeOutcome === "won" ? "Dispute won" : "Dispute lost";
  if ([17, 18].includes(order.status)) return "Dispute resolved";
  return order.status_message || "Inactive";
}

function coordinatorStatus(robot?: RobotRecord): string {
  if (robot?.activeOrderId) return `Active order #${robot.activeOrderId}`;
  if (robot?.lastOrderId) return `Last order #${robot.lastOrderId}`;
  if (robot?.error) return robot.error;
  if (robot?.loading) return "Checking...";
  if (robot?.releasedOrderId) return `No active orders · Last seen #${robot.releasedOrderId}`;
  return "No orders found";
}

function slotOrderStatus(slot: RobotSlot): string {
  if (slot.activeOrderId) return `Order #${slot.activeOrderId}`;
  if (slot.lastOrderId) return `Last #${slot.lastOrderId}`;
  const releasedOrderId = Object.values(slot.robots).find((robot) => robot.releasedOrderId)?.releasedOrderId;
  return releasedOrderId ? `No active orders · Last seen #${releasedOrderId}` : "No orders";
}
