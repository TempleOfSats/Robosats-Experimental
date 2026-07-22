import {
  AlertTriangle,
  BookmarkCheck,
  BriefcaseBusiness,
  CirclePlus,
  KeyRound,
  ListChecks,
  LogOut,
  RefreshCw,
  RotateCcw,
  Store,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { compareCoordinatorsByEstablished } from "@/domains/coordinators/coordinatorOrder";
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
import { downloadRobotTokenBackup } from "@/domains/garage/tokenBackup";
import { OrderPage } from "@/domains/orders/OrderPage";
import { ingestCoordinatorOrder } from "@/domains/orders/orderActivity";
import { submitOrderAction } from "@/domains/orders/orderApi";
import { isAlreadyCancelledError } from "@/domains/orders/orderStore";
import {
  garageReconciler,
  markProOrderActionFinished,
  markProOrderActionStarted
} from "@/domains/pro/garageReconciler";
import { useProPreferencesStore, type ProFilter, type ProView } from "@/domains/pro/proPreferencesStore";
import {
  selectOfferReadyRobots,
  selectRelevantTrades,
  summarizeProRobots
} from "@/domains/pro/proSelectors";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import type { ProTradeLocator, ProTradeSnapshot } from "@/domains/pro/pro.types";
import { GarageSetupDialog } from "@/domains/pro/GarageSetupDialog";
import { GarageRecoveryDialog } from "@/domains/pro/GarageRecoveryDialog";
import { FleetKeyDialog } from "@/domains/pro/FleetKeyDialog";
import { OfferPresetsDialog } from "@/domains/pro/OfferPresetsDialog";
import { garageSyncEngine, stopGarageSyncSchedule } from "@/domains/pro/garageSync";
import {
  FLEET_ROBOT_LIMIT_MESSAGE,
  GARAGE_LIMITS,
  hasGarageRobotCapacity
} from "@/domains/pro/garageVault";
import { selectProGarageSlots, useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { activeOfferPresets, type OfferPreset } from "@/domains/pro/portableSettings";
import { usePortableSettingsStore } from "@/domains/pro/portableSettingsStore";
import {
  ConfirmCancelOffer,
  ConfirmDeleteRobot,
  CreateOfferRobotPicker,
  RobotAddedNotice,
  TelegramCoordinatorPicker
} from "@/domains/pro/ProWorkspaceDialogs";
import { FleetGlyph, RobotGlyph } from "@/domains/pro/ProWorkspaceIcons";
import { RobotList, TradeList } from "@/domains/pro/ProWorkspaceLists";
import {
  matchesFilter,
  summaryCounts,
  summaryHasStale,
  uniquePresetName
} from "@/domains/pro/proWorkspacePresentation";
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
  const setProEnabled = useProPreferencesStore((state) => state.setEnabled);
  const vaultStatus = useGarageVaultStore((state) => state.status);
  const initializeVault = useGarageVaultStore((state) => state.initialize);
  const createDerivedRobot = useGarageVaultStore((state) => state.createDerivedRobot);
  const renameVaultRobot = useGarageVaultStore((state) => state.renameRobot);
  const removeVaultRobot = useGarageVaultStore((state) => state.removeRobot);
  const abandonFleet = useGarageVaultStore((state) => state.abandon);
  const manifest = useGarageVaultStore((state) => state.manifest);
  const portableManifest = usePortableSettingsStore((state) => state.manifest);
  const savePreset = usePortableSettingsStore((state) => state.savePreset);
  const removePreset = usePortableSettingsStore((state) => state.removePreset);
  const allSlots = useGarageStore((state) => state.slots);
  const hydrated = useGarageStore((state) => state.hydrated);
  const hydrate = useGarageStore((state) => state.hydrate);
  const setCurrentToken = useGarageStore((state) => state.setCurrentToken);
  const addSlot = useGarageStore((state) => state.addSlot);
  const removeSlot = useGarageStore((state) => state.removeSlot);
  const updateSlotIdentityDetails = useGarageStore((state) => state.updateSlotIdentityDetails);
  const coordinators = useFederationStore((state) => state.coordinators);
  const snapshots = useProTradeIndexStore((state) => state.snapshots);
  const syncBySlot = useProTradeIndexStore((state) => state.syncBySlot);
  const removeTrade = useProTradeIndexStore((state) => state.removeTrade);
  const location = useLocation();
  const navigate = useNavigate();
  const [announcement, setAnnouncement] = useState("");
  const [addingRobot, setAddingRobot] = useState(false);
  const [garageSetupOpen, setGarageSetupOpen] = useState(false);
  const [garageRecoveryOpen, setGarageRecoveryOpen] = useState(false);
  const [fleetKeyOpen, setFleetKeyOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(() => Boolean((location.state as { openPresets?: boolean } | null)?.openPresets));
  const [abandonFleetOpen, setAbandonFleetOpen] = useState(false);
  const [abandoningFleet, setAbandoningFleet] = useState(false);
  const [addedRobot, setAddedRobot] = useState<{ slotId: string; hashId: string; nickname: string }>();
  const [createPickerOpen, setCreatePickerOpen] = useState(false);
  const [pendingPresetId, setPendingPresetId] = useState<string>();
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
    void initializeVault();
  }, [enabled, hydrate, initializeVault]);

  const slots = useMemo(() => selectProGarageSlots(allSlots, manifest), [allSlots, manifest]);
  const trades = useMemo(() => selectRelevantTrades(snapshots), [snapshots]);
  const robotSummaries = useMemo(() => summarizeProRobots(slots, snapshots), [slots, snapshots]);
  const offerReadyRobots = useMemo(
    () => selectOfferReadyRobots(slots, robotSummaries),
    [robotSummaries, slots]
  );
  const offerPresets = useMemo(() => activeOfferPresets(portableManifest), [portableManifest]);
  const fleetFull = Boolean(manifest && !hasGarageRobotCapacity(manifest));
  const filteredTrades = useMemo(
    () => trades.filter((snapshot) => matchesFilter(snapshot, filter)),
    [filter, trades]
  );
  const counts = useMemo(() => summaryCounts(trades), [trades]);
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

  useEffect(() => {
    if (!addedRobot) return;
    const timeout = window.setTimeout(() => setAddedRobot(undefined), 5000);
    return () => window.clearTimeout(timeout);
  }, [addedRobot]);

  if (!enabled) return <Navigate to="/garage" replace />;

  function selectView(view: ProView) {
    setLastView(view);
  }

  function selectSummaryFilter(next: Exclude<ProFilter, "all">) {
    setLastView("trades");
    setFilter(filter === next ? "all" : next);
  }

  function startCreateOffer(slotId: string, presetId?: string) {
    const slot = slots.find((item) => item.tokenSHA256 === slotId);
    if (!slot) return;
    setCurrentToken(slot.token);
    navigate("/create", {
      state: {
        creatingOfferAs: { hashId: slot.hashId, nickname: slot.nickname },
        presetId
      }
    });
  }

  function useOfferPreset(preset: OfferPreset) {
    setPresetsOpen(false);
    setPendingPresetId(preset.id);
    setCreatePickerOpen(true);
  }

  function editOfferPreset(preset?: OfferPreset) {
    setPresetsOpen(false);
    navigate("/create", { state: { presetEditor: { id: preset?.id } } });
  }

  function duplicateOfferPreset(preset: OfferPreset) {
    const { id: _id, revision: _revision, deviceId: _deviceId, deleted: _deleted, updatedAt: _updatedAt, ...input } = preset;
    savePreset({ ...input, name: uniquePresetName(`${preset.name} copy`, offerPresets) });
    setAnnouncement(`${preset.name} duplicated.`);
  }

  function openTrade(locator: ProTradeLocator) {
    const slot = slots.find((item) => item.tokenSHA256 === locator.slotId);
    if (!slot) {
      removeTrade(locator);
      setAnnouncement(`Order ${locator.orderId} was removed because its robot is no longer in the Fleet`);
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

  async function addRobotQuickly() {
    setAddingRobot(true);
    try {
      const entry = await createDerivedRobot();
      const token = entry.token;
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
      setAddedRobot({ slotId: identity.tokenSHA256, hashId: identity.hashId, nickname: fallbackName });
      setAnnouncement("New robot added.");

      void import("@/domains/identity/roboidentitiesClient")
        .then(({ generateRoboname, prewarmRobotIdentity }) => {
          prewarmRobotIdentity(identity.hashId);
          const nickname = generateRoboname(identity.hashId);
          updateSlotIdentityDetails(token, { nickname });
          void renameVaultRobot(token, nickname);
          setAddedRobot((current) => current?.slotId === identity.tokenSHA256
            ? { ...current, nickname }
            : current);
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
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : "Could not add robot.");
    } finally {
      setAddingRobot(false);
    }
  }

  async function requestRobotCreation() {
    if (vaultStatus === "idle" || vaultStatus === "loading") {
      await initializeVault();
    }
    if (useGarageVaultStore.getState().status !== "ready") {
      setGarageSetupOpen(true);
      return;
    }
    if (fleetFull) {
      setAnnouncement(FLEET_ROBOT_LIMIT_MESSAGE);
      return;
    }
    await addRobotQuickly();
  }

  function finishFleetSetup() {
    setGarageSetupOpen(false);
    setGarageRecoveryOpen(false);
    setLastView("robots");
    navigate("/pro");
  }

  function openFleetRecovery() {
    setGarageSetupOpen(false);
    setGarageRecoveryOpen(true);
  }

  function useStandardGarage() {
    setProEnabled(false);
    navigate("/garage");
  }

  async function abandonFleetNow() {
    setAbandoningFleet(true);
    stopGarageSyncSchedule();
    try {
      await abandonFleet();
      for (const slot of slots) removeSlot(slot.token);
      useProTradeIndexStore.getState().resetRuntimeCache();
      setAbandonFleetOpen(false);
      setLastView("robots");
      setAnnouncement("Fleet removed from this device.");
    } catch (error) {
      garageSyncEngine.start(() => coordinators);
      setAnnouncement(error instanceof Error ? error.message : "Could not abandon Fleet.");
    } finally {
      setAbandoningFleet(false);
    }
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
      ingestCoordinatorOrder({
        order,
        orderId: snapshot.locator.orderId,
        shortAlias: coordinator.shortAlias,
        slot
      });
      const result = action === "pause" ? "paused" : action === "resume" ? "resumed" : "cancelled";
      setAnnouncement(`Order ${snapshot.locator.orderId} ${result}.`);
    } catch (error) {
      if (action === "cancel" && isAlreadyCancelledError(error)) {
        if (snapshot.order) {
          ingestCoordinatorOrder({
            order: { ...snapshot.order, status: 4, status_message: "Order cancelled" },
            shortAlias: coordinator.shortAlias,
            slot
          });
        } else {
          removeTrade(snapshot.locator);
        }
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

  async function deleteRobotNow(slotId: string) {
    const slot = slots.find((item) => item.tokenSHA256 === slotId);
    if (!slot) return;
    const summary = robotSummaries.find((item) => item.slotId === slotId);
    if (summary?.relevantOrderCount) {
      setDeleteSlotId(undefined);
      setAnnouncement(`${slot.nickname} cannot be removed while it has an order.`);
      return;
    }
    try {
      await removeVaultRobot(slot.token);
      removeSlot(slot.token);
      removeTradeSnapshots(slotId);
      setDeleteSlotId(undefined);
      setAnnouncement(`${slot.nickname} removed from the Fleet.`);
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : `Could not remove ${slot.nickname}.`);
    }
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
    setAnnouncement("Trade Desk refreshed");
  }

  return (
    <main className="page page-wide pro-workspace-page">
      <header className="pro-workspace-header">
        <div>
          <p className="app-eyebrow">Pro Desk</p>
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
          {lastView === "trades" ? (
            <Button
              aria-label="Create an offer"
              className="pro-create-offer-button"
              onClick={() => setCreatePickerOpen(true)}
              variant="outline"
            >
              <CirclePlus size={18} /> <span>Create offer</span>
            </Button>
          ) : (
            <Button
              aria-label={fleetFull ? `Fleet is full at ${GARAGE_LIMITS.activeRobots} robots` : "Add robot"}
              className="pro-add-robot-button"
              disabled={fleetFull}
              loading={addingRobot}
              onClick={() => void requestRobotCreation()}
              title={fleetFull ? FLEET_ROBOT_LIMIT_MESSAGE : "Add robot"}
            >
              <RobotGlyph size={18} /> <span>{fleetFull ? "Fleet full" : "Add robot"}</span>
            </Button>
          )}
        </div>
      </header>

      <p className="sr-only" aria-live="polite">{announcement}</p>
      {!garageRecoveryOpen && (garageSetupOpen || vaultStatus === "unconfigured" || vaultStatus === "needs-backup") ? (
        <GarageSetupDialog
          onComplete={finishFleetSetup}
          onRestore={openFleetRecovery}
          onUseStandardGarage={useStandardGarage}
        />
      ) : null}
      {garageRecoveryOpen ? (
        <GarageRecoveryDialog
          onClose={() => setGarageRecoveryOpen(false)}
          onRestored={finishFleetSetup}
        />
      ) : null}

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
          <div className="pro-view-tabs" role="tablist" aria-label="Trade Desk view">
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
              <ListChecks size={16} aria-hidden="true" /> Trades
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
              <FleetGlyph size={16} /> Robot Fleet
            </button>
          </div>
        </header>

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
              onCreate={() => setCreatePickerOpen(true)}
              onOpen={openTrade}
              onCancel={setCancelTrade}
              onPause={(snapshot) => void runQuickTradeAction(snapshot, "pause")}
              onResume={(snapshot) => void runQuickTradeAction(snapshot, "resume")}
              quickActionKey={quickActionKey}
              snapshots={filteredTrades}
            />
          ) : (
            <RobotList
              onCreate={startCreateOffer}
              onDelete={setDeleteSlotId}
              onDownload={(slotId) => {
                const slot = slots.find((item) => item.tokenSHA256 === slotId);
                if (slot) downloadRobotTokenBackup(slot.token, slot.nickname);
              }}
              onSettings={openRobotSettings}
              onTelegram={setTelegramSlotId}
              slots={slots}
              summaries={robotSummaries}
              syncBySlot={syncBySlot}
            />
          )}
        </div>
      </section>

      {vaultStatus === "ready" ? (
        <div className="garage-utility-bar pro-fleet-utility-bar" aria-label="Fleet controls">
          <button className="garage-utility-btn" type="button" onClick={() => setFleetKeyOpen(true)}>
            <KeyRound size={18} /> <span>Back up Fleet</span>
          </button>
          <button className="garage-utility-btn" type="button" onClick={() => setPresetsOpen(true)}>
            <BookmarkCheck size={18} /> <span>Offer presets</span>
          </button>
          <button className="garage-utility-btn" type="button" onClick={() => setAbandonFleetOpen(true)}>
            <LogOut size={18} /> <span>Abandon Fleet</span>
          </button>
        </div>
      ) : null}

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

      {createPickerOpen ? (
        <CreateOfferRobotPicker
          onAddRobot={() => void requestRobotCreation()}
          addingRobot={addingRobot}
          fleetFull={fleetFull}
          onClose={() => { setCreatePickerOpen(false); setPendingPresetId(undefined); }}
          onSelect={(slotId) => {
            setCreatePickerOpen(false);
            startCreateOffer(slotId, pendingPresetId);
            setPendingPresetId(undefined);
          }}
          robots={offerReadyRobots}
        />
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
          onConfirm={() => void deleteRobotNow(deleteSlot.tokenSHA256)}
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

      {fleetKeyOpen && vaultStatus === "ready" ? <FleetKeyDialog onClose={() => setFleetKeyOpen(false)} /> : null}

      {presetsOpen && vaultStatus === "ready" ? (
        <OfferPresetsDialog
          onClose={() => setPresetsOpen(false)}
          onCreate={() => editOfferPreset()}
          onDuplicate={duplicateOfferPreset}
          onEdit={editOfferPreset}
          onRemove={(id) => { removePreset(id); setAnnouncement("Offer preset removed."); }}
          onUse={useOfferPreset}
          presets={offerPresets}
        />
      ) : null}

      {abandonFleetOpen ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="abandon-fleet-title" onClick={() => { if (!abandoningFleet) setAbandonFleetOpen(false); }}>
          <section className="confirm-sheet pro-abandon-fleet-sheet" onClick={(event) => event.stopPropagation()}>
            <div>
              <h3 id="abandon-fleet-title">Abandon Fleet?</h3>
            </div>
            <p>
              This removes the Fleet key and every associated robot from this device. It does not cancel coordinator orders.
              Without a Fleet key backup, these robot identities cannot be restored.
            </p>
            <div className="pro-abandon-fleet-actions">
              <Button variant="outline" onClick={() => { setAbandonFleetOpen(false); setFleetKeyOpen(true); }}><KeyRound size={17} /> Back up Fleet</Button>
              <Button loading={abandoningFleet} variant="destructive" onClick={() => void abandonFleetNow()}><LogOut size={17} /> Abandon Fleet</Button>
              <Button disabled={abandoningFleet} variant="ghost" onClick={() => setAbandonFleetOpen(false)}>Keep Fleet</Button>
            </div>
          </section>
        </div>
      ) : null}

      {addedRobot ? (
        <RobotAddedNotice robot={addedRobot} onClose={() => setAddedRobot(undefined)} />
      ) : null}
    </main>
  );
}
