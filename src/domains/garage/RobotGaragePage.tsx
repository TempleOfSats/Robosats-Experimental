import { AlertTriangle, Copy, Download, Eye, EyeOff, Hash, Home, KeyRound, Plus, Search, Send, Settings, Trash2, Trophy, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppLoadingSkeleton } from "@/components/app/AppLoadingWheel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VisualSelect } from "@/components/ui/visualSelect";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { compareCoordinatorsByEstablished } from "@/domains/coordinators/coordinatorOrder";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { getRobotAuthForCoordinator, selectCurrentSlot, type RobotRecord, useGarageStore } from "@/domains/garage/garageStore";
import { TelegramSetupDialog } from "@/domains/garage/TelegramSetupDialog";
import { downloadRobotTokenBackup } from "@/domains/garage/tokenBackup";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { fetchOrder } from "@/domains/orders/orderApi";
import type { OrderDto } from "@/domains/orders/order.types";
import { currencyOptions } from "@/domains/orderbook/currencies";
import { CurrencyFlag, PaymentMethodIcons } from "@/domains/orderbook/OfferMeta";
import { RewardWithdrawalPanel } from "@/domains/rewards/RewardWithdrawalPanel";
import { formatFiat, formatSats } from "@/lib/format";
import { toUserMessage } from "@/lib/userError";

const CreateRobotPanel = lazy(() =>
  import("@/domains/garage/CreateRobotPanel").then((module) => ({ default: module.CreateRobotPanel }))
);
const RobotKeysDialog = lazy(() =>
  import("@/domains/garage/RobotKeysDialog").then((module) => ({ default: module.RobotKeysDialog }))
);

export function RobotGaragePage() {
  const [searchParams] = useSearchParams();
  const slots = useGarageStore((state) => state.slots);
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
  const [copied, setCopied] = useState(false);
  const [showRobotSwitcher, setShowRobotSwitcher] = useState(false);
  const [showRobotSettings, setShowRobotSettings] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [showLastOrder, setShowLastOrder] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [selectedAlias, setSelectedAlias] = useState<string | undefined>();
  const selectedCoordinator = displayCoordinators.find((coordinator) => coordinator.shortAlias === selectedAlias);
  const selectedRobot = selectedCoordinator && activeSlot ? activeSlot.robots[selectedCoordinator.shortAlias] : undefined;

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

  const copyToken = async () => {
    if (!activeSlot?.token) return;
    await navigator.clipboard?.writeText(activeSlot.token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  if (slots.length === 0 || showFirstRunWizard) {
    return (
      <main className="page page-narrow garage-page">
        <div className="page-heading">
          <div>
            <p className="app-eyebrow">Dashboard</p>
            <h2>Your robot identity</h2>
            <p>Generate a private token, meet your robot, then browse or create an order.</p>
          </div>
        </div>
        <Card className="import-card start-card">
          <CardContent>
            <Suspense fallback={<AppLoadingSkeleton label="Preparing robot" variant="robot" />}>
              <CreateRobotPanel onProfile={() => setShowFirstRunWizard(false)} />
            </Suspense>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!activeSlot) return null;

  return (
    <main className="page page-narrow garage-page">
      <div className="garage-profile-stage">
        <Card className="garage-robot-hero">
          <button
            className="icon-button garage-settings-btn"
            onClick={() => setShowRobotSettings(true)}
            type="button"
            title="Robot settings"
          >
            <Settings size={18} />
          </button>

          <div className="garage-robot-name">
            <strong>{activeSlot.nickname}</strong>
          </div>

          <div className="garage-robot-avatar-shell">
            <RobotAvatar hashId={activeSlot.hashId} label={activeSlot.nickname} size="xl" />
          </div>

          <div className="garage-robot-status">
            {activeSlot.activeOrderId ? (
              <Link to={orderPath(activeSlot, activeSlot.activeOrderId)}>Active order #{activeSlot.activeOrderId}</Link>
            ) : activeSlot.lastOrderId ? (
              <button type="button" onClick={() => setShowLastOrder(true)}>Last order #{activeSlot.lastOrderId}</button>
            ) : (
              <span>No existing orders found</span>
            )}
          </div>

          <div className="garage-robot-token">
            <div className="garage-token-header">
              <label className="garage-token-label">
                Token
                <span aria-hidden="true"> *</span>
              </label>
              <button
                className="icon-button"
                type="button"
                onClick={() => setShowToken(!showToken)}
                title={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {showToken ? (
              <div className="input-shell input-shell-compact">
                <input value={activeSlot.token} disabled aria-readonly aria-label="Robot token" className="garage-token-value" />
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => downloadRobotTokenBackup(activeSlot.token, activeSlot.nickname)}
                  title="Download JSON backup"
                  aria-label={`Download ${activeSlot.nickname} token backup as JSON`}
                >
                  <Download size={15} />
                </button>
                <button className="icon-button" type="button" onClick={copyToken} title={copied ? "Copied" : "Copy token"}>
                  <Copy size={15} />
                </button>
              </div>
            ) : (
              <div className="garage-token-masked">
                <span>{"••••••••••••••••••••••••••••••"}</span>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => downloadRobotTokenBackup(activeSlot.token, activeSlot.nickname)}
                  title="Download JSON backup"
                  aria-label={`Download ${activeSlot.nickname} token backup as JSON`}
                >
                  <Download size={15} />
                </button>
                <button className="icon-button" type="button" onClick={copyToken} title={copied ? "Copied" : "Copy token"}>
                  <Copy size={15} />
                </button>
              </div>
            )}
            <p className="garage-privacy-note">Reusing a trading identity degrades your privacy.</p>
          </div>
        </Card>

        <div className="next-action-grid">
          <Link className="action-tile action-tile-primary" to="/offers">
            <Search size={20} />
            <strong>Browse offers</strong>
            <span>Find a peer.</span>
          </Link>
          <Link className="action-tile" to="/create">
            <Plus size={20} />
            <strong>Create offer</strong>
            <span>Set your terms.</span>
          </Link>
        </div>

        <div className="garage-utility-bar">
          <button className="garage-utility-btn" onClick={() => setShowRobotSwitcher(true)} type="button" title="Switch robot">
            <Home size={18} />
            <span>Garage</span>
          </button>

          <button className="garage-utility-btn" onClick={() => setShowFirstRunWizard(true)} type="button" title="Add a new robot">
            <Plus size={18} />
            <span>Add Robot</span>
          </button>

          <button
            className="garage-utility-btn"
            onClick={() => setShowDeleteConfirmation(true)}
            type="button"
            title="Delete this robot"
          >
            <Trash2 size={18} />
            <span>Delete</span>
          </button>

          <button
            className="garage-utility-btn"
            onClick={() => setShowRecovery(true)}
            type="button"
            title="Recover a robot from its token"
          >
            <KeyRound size={18} />
            <span>Recover</span>
          </button>
        </div>
      </div>

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
          onRecover={(token) => {
            recoverRobotToken(token, addSlot, updateSlotIdentityDetails);
            setShowRecovery(false);
            void import("@/app/prewarm")
              .then(({ prewarmActiveRobotTradeData }) => prewarmActiveRobotTradeData())
              .catch(() => undefined);
          }}
        />
      ) : null}

      {showDeleteConfirmation ? (
        <div
          className="confirm-overlay"
          onClick={() => setShowDeleteConfirmation(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-robot-title"
        >
          <section className="confirm-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-header">
              <span className="confirm-icon-shell" aria-hidden="true"><AlertTriangle size={24} /></span>
              <h3 id="delete-robot-title">Delete {activeSlot.nickname}?</h3>
            </div>
            <p className="confirm-body">This removes the robot and its token from this device. This cannot be undone.</p>
            <div className="confirm-actions">
              <Button variant="secondary" type="button" onClick={() => setShowDeleteConfirmation(false)}>Keep robot</Button>
              <Button
                variant="destructive"
                type="button"
                onClick={() => {
                  setShowDeleteConfirmation(false);
                  removeSlot(activeSlot.token);
                }}
              >
                <Trash2 size={16} /> Delete robot
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {showRobotSettings ? (
        <RobotSettingsDialog
          activeToken={activeSlot.token}
          coordinators={displayCoordinators}
          onClose={() => {
            setShowRobotSettings(false);
            setShowKeys(false);
            setSelectedAlias(undefined);
          }}
          onCoordinatorSelect={setSelectedAlias}
          onTokenChange={setCurrentToken}
          selectedAlias={selectedAlias}
          showKeys={showKeys}
          slot={activeSlot}
          slots={slots}
          toggleKeys={() => setShowKeys((open) => !open)}
        />
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

function RobotRecoveryDialog({ onClose, onRecover }: { onClose: () => void; onRecover: (token: string) => void }) {
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
    onRecover(cleanToken);
  };

  return (
    <div className="garage-switcher-overlay" onClick={onClose}>
      <section className="garage-recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="robot-recovery-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <div className="garage-recovery-heading">
            <span className="garage-recovery-icon" aria-hidden="true"><KeyRound size={20} /></span>
            <div>
              <h3 id="robot-recovery-title">Recover a robot</h3>
              <p>Use the token you saved when this robot was created.</p>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close recovery"><X size={18} /></button>
        </header>
        <form onSubmit={submit}>
          <label className="garage-recovery-field">
            <span>Robot token</span>
            <textarea
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
          {error ? <p className="field-error">{error}</p> : null}
          <div className="garage-recovery-actions">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!cleanToken}><KeyRound size={16} />Recover robot</Button>
          </div>
        </form>
      </section>
    </div>
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

  void import("@/domains/identity/roboidentitiesClient")
    .then(({ generateRoboname, prewarmRobotIdentity }) => {
      prewarmRobotIdentity(identity.hashId);
      updateSlotIdentityDetails(token, { nickname: generateRoboname(identity.hashId) });
    })
    .catch(() => undefined);

  void import("@/domains/crypto/pgp")
    .then(({ generatePgpKeyPair }) => generatePgpKeyPair(token))
    .then((keyPair) => updateSlotIdentityDetails(token, {
      keys: {
        pubKey: keyPair.publicKeyArmored,
        encPrivKey: keyPair.encryptedPrivateKeyArmored
      }
    }))
    .catch(() => undefined);
}

export function RobotSettingsDialog({
  activeToken,
  coordinators,
  onClose,
  onCoordinatorSelect,
  onTokenChange,
  showKeys,
  slot,
  slots,
  toggleKeys
}: {
  activeToken: string;
  coordinators: CoordinatorSummary[];
  onClose: () => void;
  onCoordinatorSelect: (shortAlias: string) => void;
  onTokenChange: (token: string) => void;
  selectedAlias?: string;
  showKeys: boolean;
  slot: NonNullable<ReturnType<typeof selectCurrentSlot>>;
  slots: Array<NonNullable<ReturnType<typeof selectCurrentSlot>>>;
  toggleKeys: () => void;
}) {
  return (
    <div className="garage-settings-overlay" onClick={onClose}>
      <aside className="garage-settings-panel garage-settings-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="take-modal-close" onClick={onClose} type="button" aria-label="Close robot settings">
          <X size={20} />
        </button>

        <h2>Your Robot</h2>

        <VisualSelect
          ariaLabel="Select robot"
          className="garage-robot-select"
          onChange={onTokenChange}
          options={slots.map((item) => ({
            value: item.token,
            label: item.nickname,
            description: item.activeOrderId ? `Order #${item.activeOrderId}` : item.lastOrderId ? `Last #${item.lastOrderId}` : "No orders",
            icon: <RobotAvatar hashId={item.hashId} label={item.nickname} size="md" />
          }))}
          value={activeToken}
        />

        <Button className="garage-keys-button" type="button" onClick={toggleKeys}>
          <KeyRound size={18} />
          Keys
        </Button>

        {showKeys ? (
          <Suspense fallback={null}>
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
      </aside>
    </div>
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
    <div className="garage-switcher-overlay" onClick={onClose}>
      <div className="garage-switcher-panel" onClick={(event) => event.stopPropagation()}>
        <div className="garage-switcher-header">
          <h3>Select robot</h3>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close robot switcher">
            <X size={18} />
          </button>
        </div>
        <div className="garage-switcher-list">
          {slots.map((slot) => (
            <button
              key={slot.token}
              className={`garage-switcher-item ${slot.token === activeToken ? "active" : ""}`}
              onClick={() => onSelect(slot.token)}
              type="button"
            >
              <RobotAvatar hashId={slot.hashId} label={slot.nickname} size="md" />
              <div className="garage-switcher-item-info">
                <span className="garage-switcher-item-name">{slot.nickname}</span>
                <span className="garage-switcher-item-status">
                  {slot.activeOrderId ? `Order #${slot.activeOrderId}` : slot.lastOrderId ? `Last #${slot.lastOrderId}` : "No orders"}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
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
  const previousOrderText = robot?.lastOrderId ? `Previous order #${robot.lastOrderId}` : "You do not have previous orders";
  const rewards = robot?.earnedRewards ?? 0;
  const canSetUpTelegram = Boolean(robot?.tgBotName && robot.tgToken);
  const [showTelegramSetup, setShowTelegramSetup] = useState(false);
  const [showRewardWithdrawal, setShowRewardWithdrawal] = useState(false);
  const refreshRobots = useGarageStore((state) => state.refreshRobots);

  return (
    <div className="garage-robot-dialog-overlay" onClick={onClose}>
      <aside className="garage-robot-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="take-modal-close" onClick={onClose} type="button" aria-label="Close coordinator robot details">
          <X size={20} />
        </button>
        <header>
          <img className="coordinator-avatar coordinator-avatar-sm" src={coordinator.smallAvatarUrl} alt="" />
          <h2>{coordinator.longAlias}</h2>
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
          <button className="garage-dialog-command" disabled title="Telegram setup token is not available for this robot." type="button">
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
          <Button
            disabled={rewards <= 0}
            onClick={() => setShowRewardWithdrawal(true)}
            size="sm"
            type="button"
          >
            Claim
          </Button>
        </div>

        <Button className="garage-dialog-back" type="button" variant="ghost" onClick={onClose}>
          Back
        </Button>
      </aside>

      {showTelegramSetup && robot?.tgBotName && robot.tgToken ? (
        <TelegramSetupDialog botName={robot.tgBotName} token={robot.tgToken} onClose={() => setShowTelegramSetup(false)} />
      ) : null}

      {showRewardWithdrawal && rewards > 0 ? (
        <div
          className="garage-reward-dialog-overlay"
          onClick={(event) => {
            event.stopPropagation();
            setShowRewardWithdrawal(false);
          }}
        >
          <section className="garage-reward-dialog" role="dialog" aria-modal="true" aria-labelledby="reward-withdrawal-title" onClick={(event) => event.stopPropagation()}>
            <button className="take-modal-close" onClick={() => setShowRewardWithdrawal(false)} type="button" aria-label="Close reward withdrawal">
              <X size={20} />
            </button>
            <header>
              <Trophy size={21} />
              <div>
                <span className="app-eyebrow">Compensation</span>
                <h2 id="reward-withdrawal-title">Reward withdrawal</h2>
              </div>
            </header>
            <RewardWithdrawalPanel
              coordinators={[coordinator]}
              onClaimed={async () => {
                await refreshRobots([coordinator]);
                setShowRewardWithdrawal(false);
              }}
              slot={slot}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}

function LatestOrderDialog({ coordinators, onClose, orderId, slot }: {
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
      .then((value) => { if (!disposed) setOrder(value); })
      .catch((reason) => { if (!disposed) setError(toUserMessage(reason, "Could not load the order.")); });
    return () => { disposed = true; };
  }, [coordinator, orderId, robot?.shortAlias, slot]);

  const currency = currencyOptions().find((item) => item.code === order?.currency)?.label ?? String(order?.currency ?? "");
  const amount = order?.currency === 1000
    ? `Approx. ${formatSats(order.satoshis)}`
    : order ? formatFiat(order.amount, currency) : "";

  return (
    <div className="garage-switcher-overlay" onClick={onClose}>
      <section className="garage-last-order-dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="app-eyebrow">Last order</span>
            <h3>Order #{orderId}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close order details"><X size={18} /></button>
        </header>
        {coordinator ? (
          <div className="garage-last-order-host">
            <img className="coordinator-avatar coordinator-avatar-sm" src={coordinator.smallAvatarUrl} alt="" />
            <span><strong>{coordinator.longAlias}</strong><small>Order host</small></span>
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
            <div><dt>Status</dt><dd>{orderStatusLabel(order)}</dd></div>
            <div><dt>Amount</dt><dd><CurrencyFlag code={currency} size={18} /> {amount}</dd></div>
            <div><dt>Method</dt><dd><PaymentMethodIcons text={order.payment_method} size={18} /> {order.payment_method}</dd></div>
            <div><dt>Premium</dt><dd>{order.premium.toFixed(2)}%</dd></div>
          </dl>
        ) : null}
        <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
      </section>
    </div>
  );
}

function orderPath(slot: NonNullable<ReturnType<typeof selectCurrentSlot>>, orderId: number): string {
  const robot = Object.values(slot.robots).find((item) => item.activeOrderId === orderId || item.lastOrderId === orderId);
  return `/order/${robot?.shortAlias ?? "local"}/${orderId}`;
}

function orderStatusLabel(order: OrderDto): string {
  if (order.status === 14) return "Completed";
  if (order.status === 4) return "Cancelled";
  if (order.status === 5) return "Expired";
  if ([12, 17, 18].includes(order.status)) return "Closed";
  return order.status_message || "Inactive";
}

function coordinatorStatus(robot?: RobotRecord): string {
  if (robot?.activeOrderId) return `Active order #${robot.activeOrderId}`;
  if (robot?.lastOrderId) return `Last order #${robot.lastOrderId}`;
  if (robot?.error) return robot.error;
  if (robot?.loading) return "Checking...";
  return "No orders found";
}
