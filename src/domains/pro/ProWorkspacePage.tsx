import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  Clock3,
  Download,
  ListChecks,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Store,
  Trash2,
  X
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { compareCoordinatorsByEstablished } from "@/domains/coordinators/coordinatorOrder";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import {
  getRobotAuthForCoordinator,
  useGarageStore
} from "@/domains/garage/garageStore";
import {
  RobotCoordinatorDialog,
  RobotSettingsDialog
} from "@/domains/garage/RobotGaragePage";
import { RobotTokenBackupDialog } from "@/domains/garage/RobotTokenBackupDialog";
import { TelegramSetupDialog } from "@/domains/garage/TelegramSetupDialog";
import { generateRobotToken } from "@/domains/garage/token";
import { downloadRobotTokenBackup } from "@/domains/garage/tokenBackup";
import { formatExpiryCountdown, formatExpiryTitle } from "@/domains/orderbook/offerDisplay";
import { OrderPage } from "@/domains/orders/OrderPage";
import { submitOrderAction } from "@/domains/orders/orderApi";
import { isAlreadyCancelledError } from "@/domains/orders/orderStore";
import {
  garageReconciler,
  markProOrderActionFinished,
  markProOrderActionStarted
} from "@/domains/pro/garageReconciler";
import { toProTradePresentation } from "@/domains/pro/proPresentation";
import { useProPreferencesStore, type ProFilter, type ProView } from "@/domains/pro/proPreferencesStore";
import {
  classifyProTrade,
  selectRelevantTrades,
  summarizeProRobots
} from "@/domains/pro/proSelectors";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import type { ProTradeLocator, ProTradeSnapshot } from "@/domains/pro/pro.types";
import "@/domains/pro/proWorkspace.css";

const summaryItems: Array<{
  key: Exclude<ProFilter, "all">;
  label: string;
  icon: typeof AlertTriangle;
}> = [
  { key: "needs-action", label: "Needs action", icon: AlertTriangle },
  { key: "active", label: "Active trades", icon: BriefcaseBusiness },
  { key: "public", label: "Public offers", icon: Store },
  { key: "renewable", label: "Renewable", icon: RotateCcw }
];

export function ProWorkspacePage() {
  const enabled = useProPreferencesStore((state) => state.enabled);
  const lastView = useProPreferencesStore((state) => state.lastView);
  const filter = useProPreferencesStore((state) => state.lastFilter);
  const setLastView = useProPreferencesStore((state) => state.setLastView);
  const setFilter = useProPreferencesStore((state) => state.setLastFilter);
  const slots = useGarageStore((state) => state.slots);
  const hydrated = useGarageStore((state) => state.hydrated);
  const hydrate = useGarageStore((state) => state.hydrate);
  const setCurrentToken = useGarageStore((state) => state.setCurrentToken);
  const addSlot = useGarageStore((state) => state.addSlot);
  const removeSlot = useGarageStore((state) => state.removeSlot);
  const syncOrderSnapshot = useGarageStore((state) => state.syncOrderSnapshot);
  const updateSlotIdentityDetails = useGarageStore((state) => state.updateSlotIdentityDetails);
  const coordinators = useFederationStore((state) => state.coordinators);
  const snapshots = useProTradeIndexStore((state) => state.snapshots);
  const syncBySlot = useProTradeIndexStore((state) => state.syncBySlot);
  const removeTrade = useProTradeIndexStore((state) => state.removeTrade);
  const navigate = useNavigate();
  const [announcement, setAnnouncement] = useState("");
  const [addingRobot, setAddingRobot] = useState(false);
  const [settingsSlotId, setSettingsSlotId] = useState<string>();
  const [settingsAlias, setSettingsAlias] = useState<string>();
  const [showKeys, setShowKeys] = useState(false);
  const [backupSlotId, setBackupSlotId] = useState<string>();
  const [telegramSlotId, setTelegramSlotId] = useState<string>();
  const [telegramTarget, setTelegramTarget] = useState<{ botName: string; token: string }>();
  const [deleteSlotId, setDeleteSlotId] = useState<string>();
  const [selectedTrade, setSelectedTrade] = useState<ProTradeLocator>();
  const [quickActionKey, setQuickActionKey] = useState("");
  const [cancelTrade, setCancelTrade] = useState<ProTradeSnapshot>();
  const tradesTab = useRef<HTMLButtonElement>(null);
  const robotsTab = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!enabled) return;
    hydrate();
  }, [enabled, hydrate]);

  const trades = useMemo(() => selectRelevantTrades(snapshots), [snapshots]);
  const robotSummaries = useMemo(() => summarizeProRobots(slots, snapshots), [slots, snapshots]);
  const filteredTrades = useMemo(
    () => trades.filter((snapshot) => matchesFilter(snapshot, filter)),
    [filter, trades]
  );
  const counts = useMemo(() => summaryCounts(trades), [trades]);
  const failedRobotNames = useMemo(() => robotSummaries
    .filter((summary) => Boolean(syncBySlot[summary.slotId]?.error))
    .map((summary) => summary.nickname), [robotSummaries, syncBySlot]);
  const refreshing = Object.values(syncBySlot).some((sync) => sync.inFlight);
  const displayCoordinators = useMemo(() => coordinators
    .filter((coordinator) => coordinator.shortAlias !== "local")
    .sort(compareCoordinatorsByEstablished), [coordinators]);
  const settingsSlot = slots.find((slot) => slot.tokenSHA256 === settingsSlotId);
  const backupSlot = slots.find((slot) => slot.tokenSHA256 === backupSlotId);
  const telegramSlot = slots.find((slot) => slot.tokenSHA256 === telegramSlotId);
  const deleteSlot = slots.find((slot) => slot.tokenSHA256 === deleteSlotId);
  const settingsCoordinator = displayCoordinators.find((coordinator) => coordinator.shortAlias === settingsAlias);
  const settingsRobot = settingsCoordinator && settingsSlot ? settingsSlot.robots[settingsCoordinator.shortAlias] : undefined;

  if (!enabled) return <Navigate to="/garage" replace />;

  function selectView(view: ProView) {
    setLastView(view);
  }

  function selectSummaryFilter(next: Exclude<ProFilter, "all">) {
    setLastView("trades");
    setFilter(filter === next ? "all" : next);
  }

  function useRobot(slotId: string, path: string) {
    const slot = slots.find((item) => item.tokenSHA256 === slotId);
    if (!slot) return;
    setCurrentToken(slot.token);
    navigate(path);
  }

  function openTrade(locator: ProTradeLocator) {
    const slot = slots.find((item) => item.tokenSHA256 === locator.slotId);
    if (!slot) {
      removeTrade(locator);
      setAnnouncement(`Order ${locator.orderId} was removed because its robot is no longer in the Garage`);
      return;
    }
    setCurrentToken(slot.token);
    setSelectedTrade(locator);
  }

  const closeTrade = useCallback(() => {
    setSelectedTrade(undefined);
    void garageReconciler.reconcileAll("order-action");
  }, []);

  function openRobotSettings(slotId: string) {
    const slot = slots.find((item) => item.tokenSHA256 === slotId);
    if (!slot) return;
    setCurrentToken(slot.token);
    setSettingsSlotId(slotId);
    setSettingsAlias(undefined);
    setShowKeys(false);
  }

  function closeRobotSettings() {
    setSettingsSlotId(undefined);
    setSettingsAlias(undefined);
    setShowKeys(false);
  }

  function addRobotQuickly() {
    setAddingRobot(true);
    const token = generateRobotToken();
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
    setAnnouncement("New robot added. Download its token backup before trading.");
    setAddingRobot(false);

    void import("@/domains/identity/roboidentitiesClient")
      .then(({ generateRoboname, prewarmRobotIdentity }) => {
        prewarmRobotIdentity(identity.hashId);
        updateSlotIdentityDetails(token, { nickname: generateRoboname(identity.hashId) });
      })
      .catch(() => undefined);
    window.setTimeout(() => {
      void import("@/domains/crypto/pgp")
        .then(({ generatePgpKeyPair }) => generatePgpKeyPair(token))
        .then((keyPair) => updateSlotIdentityDetails(token, {
          keys: {
            pubKey: keyPair.publicKeyArmored,
            encPrivKey: keyPair.encryptedPrivateKeyArmored
          }
        }))
        .catch(() => undefined);
    }, 600);
  }

  async function runQuickTradeAction(snapshot: ProTradeSnapshot, action: "pause" | "resume" | "cancel") {
    const slot = slots.find((item) => item.tokenSHA256 === snapshot.locator.slotId);
    const coordinator = coordinators.find((item) => item.shortAlias === snapshot.locator.shortAlias);
    const auth = coordinator && slot ? getRobotAuthForCoordinator(slot, coordinator.shortAlias) : undefined;
    if (!slot || !coordinator || !auth) {
      setAnnouncement(`Could not ${action} order ${snapshot.locator.orderId}. Robot credentials are unavailable.`);
      return;
    }

    const actionKey = `${snapshot.key}:${action}`;
    setQuickActionKey(actionKey);
    markProOrderActionStarted(snapshot.locator);
    try {
      const order = await submitOrderAction(
        coordinator.url,
        snapshot.locator.orderId,
        action === "pause" || action === "resume"
          ? { action: "pause" }
          : { action: "cancel", cancel_status: snapshot.order?.status },
        auth
      );
      syncOrderSnapshot({
        token: slot.token,
        shortAlias: coordinator.shortAlias,
        orderId: snapshot.locator.orderId,
        status: order.status,
        isMaker: order.is_maker
      });
      const result = action === "pause" ? "paused" : action === "resume" ? "resumed" : "cancelled";
      setAnnouncement(`Order ${snapshot.locator.orderId} ${result}.`);
      if (action === "cancel") {
        removeTrade(snapshot.locator);
        return;
      }
      await garageReconciler.reconcileOrder(snapshot.locator, "order-action");
    } catch (error) {
      if (action === "cancel" && isAlreadyCancelledError(error)) {
        syncOrderSnapshot({
          token: slot.token,
          shortAlias: coordinator.shortAlias,
          orderId: snapshot.locator.orderId,
          status: 4,
          isMaker: snapshot.order?.is_maker
        });
        removeTrade(snapshot.locator);
        setAnnouncement(`Order ${snapshot.locator.orderId} was already cancelled.`);
        return;
      }
      setAnnouncement(`Could not ${action} order ${snapshot.locator.orderId}. Try again.`);
    } finally {
      markProOrderActionFinished(snapshot.locator);
      setQuickActionKey("");
      setCancelTrade(undefined);
    }
  }

  function deleteRobotNow(slotId: string) {
    const slot = slots.find((item) => item.tokenSHA256 === slotId);
    if (!slot) return;
    removeSlot(slot.token);
    removeTradeSnapshots(slotId);
    setDeleteSlotId(undefined);
    setAnnouncement(`${slot.nickname} removed from this device.`);
  }

  function removeTradeSnapshots(slotId: string) {
    useProTradeIndexStore.getState().removeSlotSnapshots(slotId);
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, view: ProView) {
    let next: ProView | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = view === "trades" ? "robots" : "trades";
    if (event.key === "Home") next = "trades";
    if (event.key === "End") next = "robots";
    if (!next) return;
    event.preventDefault();
    selectView(next);
    (next === "trades" ? tradesTab : robotsTab).current?.focus();
  }

  async function refresh() {
    setAnnouncement("Refreshing trade desk");
    await garageReconciler.reconcileAll("manual");
    setAnnouncement("Trade desk refreshed");
  }

  return (
    <main className="page page-wide pro-workspace-page">
      <header className="pro-workspace-header">
        <div>
          <p className="app-eyebrow">PRO</p>
          <h2>Trade desk</h2>
        </div>
        <div className="pro-workspace-commands">
          <Button
            aria-label="Refresh trade desk"
            disabled={refreshing || !hydrated}
            className="pro-refresh-button"
            onClick={() => void refresh()}
            size="icon"
            title="Refresh"
            variant="outline"
          >
            <RefreshCw className={refreshing ? "pro-refresh-icon pro-refresh-icon-active" : "pro-refresh-icon"} size={17} />
          </Button>
          <Button className="pro-add-robot-button" loading={addingRobot} onClick={addRobotQuickly}>
            <RobotGlyph size={18} /> <span>Add robot</span>
          </Button>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">{announcement}</p>

      <section className="pro-summary-strip" aria-label="Trade summary">
        {summaryItems.map((item) => {
          const Icon = item.icon;
          const selected = filter === item.key && lastView === "trades";
          const stale = summaryHasStale(trades, item.key);
          return (
            <button
              className={selected ? "pro-summary-item active" : "pro-summary-item"}
              key={item.key}
              type="button"
              aria-pressed={selected}
              onClick={() => selectSummaryFilter(item.key)}
            >
              <Icon size={17} aria-hidden="true" />
              <strong>{counts[item.key]}</strong>
              <span>{item.label}{stale ? <small>Stale</small> : null}</span>
            </button>
          );
        })}
      </section>

      <section className="pro-workspace-surface">
        <header className="pro-workspace-toolbar">
          <div className="pro-view-tabs" role="tablist" aria-label="Trade desk view">
            <button
              id="pro-trades-tab"
              ref={tradesTab}
              type="button"
              role="tab"
              aria-selected={lastView === "trades"}
              aria-controls="pro-workspace-content"
              tabIndex={lastView === "trades" ? 0 : -1}
              onKeyDown={(event) => moveTab(event, "trades")}
              onClick={() => selectView("trades")}
            >
              Trades
            </button>
            <button
              id="pro-robots-tab"
              ref={robotsTab}
              type="button"
              role="tab"
              aria-selected={lastView === "robots"}
              aria-controls="pro-workspace-content"
              tabIndex={lastView === "robots" ? 0 : -1}
              onKeyDown={(event) => moveTab(event, "robots")}
              onClick={() => selectView("robots")}
            >
              Robots
            </button>
          </div>
        </header>

        {failedRobotNames.length > 0 ? (
          <div className="pro-refresh-warning" role="status">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>
              <strong>{failedRobotNames.length === 1
                ? `Could not refresh ${failedRobotNames[0]}`
                : `Could not refresh ${failedRobotNames.length} robots`}</strong>
              <small>Last known trade states are preserved.</small>
            </span>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>Retry</Button>
          </div>
        ) : null}

        <div
          id="pro-workspace-content"
          className="pro-workspace-content"
          role="tabpanel"
          aria-labelledby={lastView === "trades" ? "pro-trades-tab" : "pro-robots-tab"}
          aria-busy={refreshing}
        >
          {lastView === "trades" ? (
            <TradeList
              coordinators={coordinators}
              onOpen={openTrade}
              onCancel={setCancelTrade}
              onPause={(snapshot) => void runQuickTradeAction(snapshot, "pause")}
              onResume={(snapshot) => void runQuickTradeAction(snapshot, "resume")}
              quickActionKey={quickActionKey}
              snapshots={filteredTrades}
            />
          ) : (
            <RobotList
              onCreate={(slotId) => useRobot(slotId, "/create")}
              onDelete={setDeleteSlotId}
              onDownload={(slotId) => {
                const slot = slots.find((item) => item.tokenSHA256 === slotId);
                if (slot) downloadRobotTokenBackup(slot.token, slot.nickname);
              }}
              onSettings={openRobotSettings}
              onTelegram={setTelegramSlotId}
              onUse={(slotId) => useRobot(slotId, "/garage")}
              slots={slots}
              summaries={robotSummaries}
              syncBySlot={syncBySlot}
            />
          )}
        </div>
      </section>

      {selectedTrade ? (
        <div className="pro-trade-dialog-overlay" role="dialog" aria-modal="true" aria-label={`Order ${selectedTrade.orderId}`} onClick={closeTrade}>
          <section className="pro-trade-dialog" onClick={(event) => event.stopPropagation()}>
            <button className="take-modal-close" onClick={closeTrade} type="button" aria-label="Close trade">
              <X size={20} />
            </button>
            <OrderPage embeddedLocator={selectedTrade} onEmbeddedClose={closeTrade} />
          </section>
        </div>
      ) : null}

      {settingsSlot ? (
        <RobotSettingsDialog
          activeToken={settingsSlot.token}
          coordinators={displayCoordinators}
          onClose={closeRobotSettings}
          onCoordinatorSelect={setSettingsAlias}
          onTokenBackup={() => setBackupSlotId(settingsSlot.tokenSHA256)}
          onTokenChange={(token) => {
            const slot = slots.find((item) => item.token === token);
            if (!slot) return;
            setCurrentToken(token);
            setSettingsSlotId(slot.tokenSHA256);
            setSettingsAlias(undefined);
            setShowKeys(false);
          }}
          showKeys={showKeys}
          slot={settingsSlot}
          slots={slots}
          toggleKeys={() => setShowKeys((open) => !open)}
        />
      ) : null}

      {settingsCoordinator && settingsSlot ? (
        <RobotCoordinatorDialog
          coordinator={settingsCoordinator}
          onClose={() => setSettingsAlias(undefined)}
          robot={settingsRobot}
          slot={settingsSlot}
        />
      ) : null}

      {backupSlot ? (
        <RobotTokenBackupDialog
          onClose={() => setBackupSlotId(undefined)}
          robotName={backupSlot.nickname}
          token={backupSlot.token}
        />
      ) : null}

      {telegramSlot ? (
        <TelegramCoordinatorPicker
          coordinators={displayCoordinators}
          onClose={() => setTelegramSlotId(undefined)}
          onSelect={(botName, token) => {
            setTelegramSlotId(undefined);
            setTelegramTarget({ botName, token });
          }}
          slot={telegramSlot}
        />
      ) : null}

      {telegramTarget ? (
        <TelegramSetupDialog
          botName={telegramTarget.botName}
          token={telegramTarget.token}
          onClose={() => setTelegramTarget(undefined)}
        />
      ) : null}

      {deleteSlot ? (
        <ConfirmDeleteRobot
          onCancel={() => setDeleteSlotId(undefined)}
          onConfirm={() => deleteRobotNow(deleteSlot.tokenSHA256)}
          robotName={deleteSlot.nickname}
        />
      ) : null}

      {cancelTrade ? (
        <ConfirmCancelOffer
          loading={quickActionKey === `${cancelTrade.key}:cancel`}
          onCancel={() => setCancelTrade(undefined)}
          onConfirm={() => void runQuickTradeAction(cancelTrade, "cancel")}
          orderId={cancelTrade.locator.orderId}
        />
      ) : null}
    </main>
  );
}

function TradeList({
  coordinators,
  onCancel,
  onOpen,
  onPause,
  onResume,
  quickActionKey,
  snapshots
}: {
  coordinators: ReturnType<typeof useFederationStore.getState>["coordinators"];
  onCancel: (snapshot: ProTradeSnapshot) => void;
  onOpen: (locator: ProTradeLocator) => void;
  onPause: (snapshot: ProTradeSnapshot) => void;
  onResume: (snapshot: ProTradeSnapshot) => void;
  quickActionKey: string;
  snapshots: ProTradeSnapshot[];
}) {
  if (snapshots.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No matching trades"
        body="Active trades and public offers for every robot will appear here."
      />
    );
  }

  return (
    <div className="pro-trade-list" aria-label="Trades">
      <div className="pro-trade-header" aria-hidden="true">
        <span>Robot</span>
        <span>Order</span>
        <span>Coordinator</span>
        <span>Status</span>
        <span>Deadline</span>
        <span>Actions</span>
      </div>
      {snapshots.map((snapshot, index) => {
        const presentation = toProTradePresentation(snapshot);
        const StatusIcon = presentation.statusIcon;
        const coordinator = coordinators.find((item) => item.shortAlias === snapshot.locator.shortAlias);
        const previous = snapshots[index - 1];
        const showGroup = !previous || toProTradePresentation(previous).group !== presentation.group;
        return (
          <Fragment key={snapshot.key}>
            {showGroup ? <div className="pro-trade-group">{groupLabel(presentation.group)}</div> : null}
            <div className="pro-trade-row">
              <button
                className="pro-trade-row-open"
                type="button"
                aria-label={`Open order ${snapshot.locator.orderId} for ${snapshot.nickname}`}
                onClick={() => onOpen(snapshot.locator)}
              >
                <span className="pro-trade-robot">
                  <RobotAvatar hashId={snapshot.hashId} label={snapshot.nickname} size="sm" />
                  <span><strong>{snapshot.nickname}</strong><small>{presentation.directionLabel}</small></span>
                </span>
                <span className="pro-trade-order">
                  <strong>{presentation.amountLabel}</strong>
                  <small>{presentation.methodLabel} · #{snapshot.locator.orderId}</small>
                </span>
                <span className="pro-trade-coordinator">
                  {coordinator ? <img className="coordinator-avatar coordinator-avatar-xs" src={coordinator.smallAvatarUrl} alt="" /> : null}
                  <span>{coordinator?.longAlias ?? snapshot.locator.shortAlias}</span>
                </span>
                <span>
                  <Badge tone={presentation.statusTone} icon={<StatusIcon size={12} />}>{presentation.statusLabel}</Badge>
                </span>
                <span className="pro-trade-deadline" title={formatExpiryTitle(snapshot.order?.expires_at)}>
                  <Clock3 size={15} aria-hidden="true" />
                  {presentation.deadline ? formatExpiryCountdown(snapshot.order?.expires_at) : "-"}
                </span>
              </button>
              <span className="pro-trade-actions">
                {snapshot.order?.status === 1 && snapshot.order.is_maker ? (
                  <>
                    <Button
                      aria-label={`Pause order ${snapshot.locator.orderId}`}
                      className="pro-trade-action-button"
                      disabled={Boolean(quickActionKey)}
                      loading={quickActionKey === `${snapshot.key}:pause`}
                      onClick={() => onPause(snapshot)}
                      size="sm"
                      title="Hide this offer from the public order book"
                      variant="outline"
                    >
                      <Pause size={14} /> <span className="pro-trade-action-label">Pause</span>
                    </Button>
                    <Button
                      aria-label={`Cancel order ${snapshot.locator.orderId}`}
                      className="pro-trade-action-button"
                      disabled={Boolean(quickActionKey)}
                      onClick={() => onCancel(snapshot)}
                      size="sm"
                      title="Cancel this offer"
                      variant="destructive"
                    >
                      <X size={14} /> <span className="pro-trade-action-label">Cancel</span>
                    </Button>
                  </>
                ) : snapshot.order?.status === 2 && snapshot.order.is_maker ? (
                  <>
                    <Button
                      aria-label={`Resume order ${snapshot.locator.orderId}`}
                      className="pro-trade-action-button"
                      disabled={Boolean(quickActionKey)}
                      loading={quickActionKey === `${snapshot.key}:resume`}
                      onClick={() => onResume(snapshot)}
                      size="sm"
                      title="Return this offer to the public order book"
                      variant="outline"
                    >
                      <Play size={14} /> <span className="pro-trade-action-label">Resume</span>
                    </Button>
                    <button className="pro-trade-open-icon" type="button" aria-label={`Open order ${snapshot.locator.orderId}`} onClick={() => onOpen(snapshot.locator)}>
                      <ChevronRight size={18} />
                    </button>
                  </>
                ) : (
                  <button className="pro-trade-open-icon" type="button" aria-label={`Open order ${snapshot.locator.orderId}`} onClick={() => onOpen(snapshot.locator)}>
                    <ChevronRight size={18} />
                  </button>
                )}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function RobotList({
  onCreate,
  onDelete,
  onDownload,
  onSettings,
  onTelegram,
  onUse,
  slots,
  summaries,
  syncBySlot
}: {
  onCreate: (slotId: string) => void;
  onDelete: (slotId: string) => void;
  onDownload: (slotId: string) => void;
  onSettings: (slotId: string) => void;
  onTelegram: (slotId: string) => void;
  onUse: (slotId: string) => void;
  slots: ReturnType<typeof useGarageStore.getState>["slots"];
  summaries: ReturnType<typeof summarizeProRobots>;
  syncBySlot: ReturnType<typeof useProTradeIndexStore.getState>["syncBySlot"];
}) {
  if (slots.length === 0) {
    return <EmptyState icon={Bot} title="No robots in this Garage" body="Create or recover a robot from the normal Garage." />;
  }

  return (
    <div className="pro-robot-list">
      {summaries.map((summary) => {
        const slot = slots.find((item) => item.tokenSHA256 === summary.slotId);
        const sync = syncBySlot[summary.slotId];
        if (!slot) return null;
        return (
          <article className="pro-robot-row" key={summary.slotId}>
            <div className="pro-robot-identity">
              <button className="pro-robot-avatar-button" type="button" onClick={() => onSettings(summary.slotId)} aria-label={`Open ${summary.nickname} settings`}>
                <RobotAvatar hashId={summary.hashId} label={summary.nickname} size="md" />
              </button>
              <span>
                <strong>{summary.nickname}</strong>
                <span className="pro-robot-state">
                  <Badge tone={summary.stale ? "muted" : summary.needsAttentionCount ? "warning" : "success"}>
                    {summary.stale ? "Stale" : summary.needsAttentionCount ? "Needs attention" : "Ready"}
                  </Badge>
                  <small>{formatLastRefresh(sync?.lastSuccessAt)}</small>
                </span>
              </span>
            </div>
            <div className="pro-robot-actions">
              <Button size="icon" variant="ghost" onClick={() => onDownload(summary.slotId)} aria-label={`Download ${summary.nickname} recovery JSON`} title="Download recovery JSON">
                <Download size={16} />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => onTelegram(summary.slotId)} aria-label={`Enable Telegram for ${summary.nickname}`} title="Enable Telegram">
                <Send size={16} />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onCreate(summary.slotId)}>Create offer</Button>
              <Button size="sm" variant="secondary" onClick={() => onUse(summary.slotId)}>Use robot <ArrowRight size={15} /></Button>
              <Button size="icon" variant="ghost" onClick={() => onDelete(summary.slotId)} aria-label={`Delete ${summary.nickname}`} title="Delete robot">
                <Trash2 size={16} />
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof Bot; title: string; body: string }) {
  const navigate = useNavigate();
  const noRobots = title.includes("No robots");
  return (
    <div className="pro-empty-state">
      <Icon size={22} aria-hidden="true" />
      <div><strong>{title}</strong><p>{body}</p></div>
      <div>
        <Button size="sm" variant="secondary" onClick={() => navigate(noRobots ? "/garage?add=1" : "/offers")}>
          {noRobots ? "Add robot" : "Browse offers"}
        </Button>
        {!noRobots ? <Button size="sm" variant="ghost" onClick={() => navigate("/create")}>Create offer</Button> : null}
      </div>
    </div>
  );
}

function RobotGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
      <path d="M20 9V7a2 2 0 0 0-2-2h-3a3 3 0 0 0-6 0H6a2 2 0 0 0-2 2v2a3 3 0 0 0-3 3 3 3 0 0 0 3 3v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4a3 3 0 0 0 3-3 3 3 0 0 0-3-3Z" />
      <circle cx="9" cy="11.5" r="1" />
      <circle cx="15" cy="11.5" r="1" />
      <path d="M8 17h8" />
    </svg>
  );
}

function TelegramCoordinatorPicker({
  coordinators,
  onClose,
  onSelect,
  slot
}: {
  coordinators: ReturnType<typeof useFederationStore.getState>["coordinators"];
  onClose: () => void;
  onSelect: (botName: string, token: string) => void;
  slot: ReturnType<typeof useGarageStore.getState>["slots"][number];
}) {
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="pro-telegram-title" onClick={onClose}>
      <section className="confirm-sheet pro-telegram-picker" onClick={(event) => event.stopPropagation()}>
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
            return (
              <button
                className="pro-telegram-coordinator"
                disabled={!available}
                key={coordinator.shortAlias}
                onClick={() => {
                  if (robot?.tgBotName && robot.tgToken) onSelect(robot.tgBotName, robot.tgToken);
                }}
                type="button"
              >
                <img className="coordinator-avatar coordinator-avatar-sm" src={coordinator.smallAvatarUrl} alt="" />
                <span>
                  <strong>{coordinator.longAlias}</strong>
                  <small>{available ? "Telegram setup available" : "Connect this robot first"}</small>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <div className="confirm-actions">
          <Button variant="secondary" onClick={onClose}>Back</Button>
        </div>
      </section>
    </div>
  );
}

function ConfirmDeleteRobot({
  onCancel,
  onConfirm,
  robotName
}: {
  onCancel: () => void;
  onConfirm: () => void;
  robotName: string;
}) {
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="pro-delete-robot-title" onClick={onCancel}>
      <section className="confirm-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-header">
          <span className="confirm-icon-shell" aria-hidden="true"><AlertTriangle size={22} /></span>
          <h3 id="pro-delete-robot-title">Delete {robotName}?</h3>
        </div>
        <p className="confirm-body">This removes the robot and its token from this device. Download the recovery JSON first if you may need it again.</p>
        <div className="confirm-actions">
          <Button variant="secondary" onClick={onCancel}>Keep robot</Button>
          <Button variant="destructive" onClick={onConfirm}><Trash2 size={16} /> Delete robot</Button>
        </div>
      </section>
    </div>
  );
}

function ConfirmCancelOffer({
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
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="pro-cancel-offer-title" onClick={onCancel}>
      <section className="confirm-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-header">
          <span className="confirm-icon-shell" aria-hidden="true"><AlertTriangle size={22} /></span>
          <h3 id="pro-cancel-offer-title">Cancel order #{orderId}?</h3>
        </div>
        <p className="confirm-body">The offer will be removed from the public order book. This cannot be undone.</p>
        <div className="confirm-actions">
          <Button disabled={loading} variant="secondary" onClick={onCancel}>Keep offer</Button>
          <Button loading={loading} variant="destructive" onClick={onConfirm}><X size={16} /> Cancel offer</Button>
        </div>
      </section>
    </div>
  );
}

function summaryCounts(trades: ProTradeSnapshot[]): Record<Exclude<ProFilter, "all">, number> {
  return {
    "needs-action": trades.filter((trade) => classifyProTrade(trade) === "needs-action").length,
    active: trades.filter((trade) => isActiveTrade(trade)).length,
    public: trades.filter((trade) => trade.order?.status === 1 && trade.order.is_maker).length,
    renewable: trades.filter((trade) => trade.renewable).length
  };
}

function summaryHasStale(trades: ProTradeSnapshot[], filter: Exclude<ProFilter, "all">): boolean {
  return trades.some((trade) => {
    if (trade.freshness !== "error" && trade.freshness !== "stale") return false;
    if (filter === "needs-action") return classifyProTrade({ ...trade, freshness: "fresh" }) === "needs-action";
    if (filter === "active") return isActiveTrade(trade);
    if (filter === "public") return trade.order?.status === 1 && trade.order.is_maker;
    return trade.renewable;
  });
}

function matchesFilter(snapshot: ProTradeSnapshot, filter: ProFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs-action") return classifyProTrade(snapshot) === "needs-action";
  if (filter === "active") return isActiveTrade(snapshot);
  if (filter === "public") return snapshot.order?.status === 1 && snapshot.order.is_maker;
  return snapshot.renewable;
}

function groupLabel(group: ReturnType<typeof classifyProTrade>): string {
  if (group === "needs-action") return "Needs action";
  if (group === "in-progress") return "In progress";
  if (group === "waiting") return "Waiting and public";
  if (group === "renewable") return "Renewable";
  return "Refresh needed";
}

function isActiveTrade(snapshot: ProTradeSnapshot): boolean {
  const status = snapshot.order?.status;
  return status != null && status >= 3 && ![4, 5, 12, 14, 17, 18].includes(status);
}

function formatLastRefresh(value?: number): string {
  if (!value) return "Not refreshed";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (elapsedMinutes < 1) return "Updated now";
  if (elapsedMinutes < 60) return `Updated ${elapsedMinutes}m ago`;
  return `Updated ${Math.floor(elapsedMinutes / 60)}h ago`;
}
