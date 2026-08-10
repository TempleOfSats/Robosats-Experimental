import {
  AlertTriangle,
  BookmarkCheck,
  BriefcaseBusiness,
  CirclePlus,
  CloudUpload,
  KeyRound,
  ListChecks,
  LogOut,
  History,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Store,
  X
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AppTransitionDialog, AppTransitionFeedback } from "@/domains/navigation/AppTransitionFeedback";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InfoHint } from "@/components/ui/infoHint";
import { Tabs, tabId } from "@/components/ui/tabs";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { compareCoordinatorsByEstablished } from "@/domains/coordinators/coordinatorOrder";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { getRobotAuthForCoordinator, type RobotSlot, useGarageStore } from "@/domains/garage/garageStore";
import { downloadRobotTokenBackup } from "@/domains/garage/tokenBackup";
import type { CreateOrderDraft } from "@/domains/maker/maker.types";
import { currencyIdFromCode } from "@/domains/orderbook/currencies";
import type { GuidedTradeCriteria } from "@/domains/orderbook/guidedTrade";
import { useOrderbookStore } from "@/domains/orderbook/orderbookStore";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { ingestCoordinatorOrder } from "@/domains/orders/orderActivity";
import { submitOrderAction } from "@/domains/orders/orderApi";
import { loadOrderPage } from "@/domains/orders/orderRoute";
import { isAlreadyCancelledError } from "@/domains/orders/orderStore";
import {
  garageReconciler,
  markProOrderActionFinished,
  markProOrderActionStarted
} from "@/domains/pro/garageReconciler";
import { useProPreferencesStore, type ProFilter, type ProView } from "@/domains/pro/proPreferencesStore";
import { selectRelevantTrades, summarizeProRobots } from "@/domains/pro/proSelectors";
import {
  deriveProRobotLifecycle,
  proRobotStatusTimestamp,
  selectOfferReadyRobots
} from "@/domains/pro/proRobotLifecycle";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import type { ProTradeLocator, ProTradeSnapshot } from "@/domains/pro/pro.types";
import { GarageSetupDialog } from "@/domains/pro/GarageSetupDialog";
import { GarageRecoveryDialog } from "@/domains/pro/GarageRecoveryDialog";
import { FleetKeyDialog } from "@/domains/pro/FleetKeyDialog";
import { OfferPresetsDialog } from "@/domains/pro/OfferPresetsDialog";
import { garageSyncEngine, stopGarageSyncSchedule } from "@/domains/pro/garageSync";
import { FLEET_ROBOT_LIMIT_MESSAGE, GARAGE_LIMITS, hasGarageRobotCapacity } from "@/domains/pro/garageVault";
import { selectProGarageSlots, useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { activeOfferPresets, type OfferPreset } from "@/domains/pro/portableSettings";
import { usePortableSettingsStore } from "@/domains/pro/portableSettingsStore";
import {
  ConfirmCancelOffer,
  ConfirmDeleteRobot,
  CreateOfferRobotPicker,
  ProActionNotice,
  TelegramCoordinatorPicker
} from "@/domains/pro/ProWorkspaceDialogs";
import { AddRobotGlyph, FleetGlyph } from "@/domains/pro/ProWorkspaceIcons";
import { HistoryList, RobotList, TradeList } from "@/domains/pro/ProWorkspaceLists";
import {
  matchesFilter,
  summaryCounts,
  summaryHasStale,
  uniquePresetName
} from "@/domains/pro/proWorkspacePresentation";
import { fleetProtectionPresentation } from "@/domains/pro/proSyncPresentation";
import { shouldRefreshRobotStatus } from "@/domains/pro/reconcilePolicy";
import "@/domains/pro/proWorkspace.css";

const MANUAL_REFRESH_FOREGROUND_MS = 8_000;

type WorkspaceActionNotice = {
  id: number;
  title: string;
  detail: string;
  robot?: { slotId: string; hashId: string; nickname: string };
};

const LazyBeginnerTradeWizard = lazy(() =>
  import("@/domains/orderbook/BeginnerTradeWizard").then((module) => ({ default: module.BeginnerTradeWizard }))
);
const LazyOrderPage = lazy(() => loadOrderPage().then((module) => ({ default: module.OrderPage })));
const LazyRobotCoordinatorDialog = lazy(() =>
  import("@/domains/garage/RobotGaragePage").then((module) => ({ default: module.RobotCoordinatorDialog }))
);
const LazyRobotSettingsDialog = lazy(() =>
  import("@/domains/garage/RobotGaragePage").then((module) => ({ default: module.RobotSettingsDialog }))
);
const LazyRobotTokenBackupDialog = lazy(() =>
  import("@/domains/garage/RobotTokenBackupDialog").then((module) => ({ default: module.RobotTokenBackupDialog }))
);
const LazyTelegramSetupDialog = lazy(() =>
  import("@/domains/garage/TelegramSetupDialog").then((module) => ({ default: module.TelegramSetupDialog }))
);
const LazyRewardWithdrawalDialog = lazy(() =>
  import("@/domains/rewards/RewardWithdrawalDialog").then((module) => ({ default: module.RewardWithdrawalDialog }))
);

const summaryItems: Array<{
  key: Exclude<ProFilter, "all">;
  label: string;
  icon: typeof AlertTriangle;
}> = [
  { key: "needs-action", label: "Needs action", icon: AlertTriangle },
  { key: "active", label: "In progress", icon: BriefcaseBusiness },
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
  const vaultSyncStatus = useGarageVaultStore((state) => state.syncStatus);
  const pendingFleetChanges = useGarageVaultStore((state) => state.envelope?.outbox.length ?? 0);
  const synchronizedFleetRecords = useGarageVaultStore(
    (state) => Object.keys(state.envelope?.observed ?? {}).length > 0
  );
  const initializeVault = useGarageVaultStore((state) => state.initialize);
  const createDerivedRobot = useGarageVaultStore((state) => state.createDerivedRobot);
  const renameVaultRobot = useGarageVaultStore((state) => state.renameRobot);
  const removeVaultRobot = useGarageVaultStore((state) => state.removeRobot);
  const abandonFleet = useGarageVaultStore((state) => state.abandon);
  const manifest = useGarageVaultStore((state) => state.manifest);
  const tradeHistory = useGarageVaultStore((state) => state.history);
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
  const routeState = location.state as {
    openCreate?: boolean;
    openPresets?: boolean;
    prefillDraft?: Pick<CreateOrderDraft, "amount" | "currency" | "paymentMethod" | "type">;
  } | null;
  const [announcement, setAnnouncement] = useState("");
  const [addingRobot, setAddingRobot] = useState(false);
  const [garageSetupOpen, setGarageSetupOpen] = useState(false);
  const [garageRecoveryOpen, setGarageRecoveryOpen] = useState(false);
  const [fleetKeyOpen, setFleetKeyOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(() => Boolean(routeState?.openPresets));
  const [abandonFleetOpen, setAbandonFleetOpen] = useState(false);
  const [abandoningFleet, setAbandoningFleet] = useState(false);
  const [actionNotice, setActionNotice] = useState<WorkspaceActionNotice>();
  const actionNoticeSequence = useRef(0);
  const [createPickerOpen, setCreatePickerOpen] = useState(() => Boolean(routeState?.openCreate));
  const [pendingCreatePrefill, setPendingCreatePrefill] = useState(routeState?.prefillDraft);
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
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [rewardSlotId, setRewardSlotId] = useState<string>();
  const [guidedTradeOpen, setGuidedTradeOpen] = useState(false);
  const guidedOrders = useOrderbookStore((state) => state.orders);
  const guidedOrdersLoading = useOrderbookStore((state) => state.loading);
  const guidedOrdersRefreshing = useOrderbookStore((state) => state.refreshing);
  const refreshOrderbook = useOrderbookStore((state) => state.refreshOrderbook);

  useEffect(() => {
    if (!enabled) return;
    hydrate();
    void initializeVault();
  }, [enabled, hydrate, initializeVault]);

  const slots = useMemo(() => selectProGarageSlots(allSlots, manifest), [allSlots, manifest]);
  const trades = useMemo(() => selectRelevantTrades(snapshots), [snapshots]);
  const rewardSlots = useMemo(() => slots.filter((slot) => slot.earnedRewards > 0), [slots]);
  const robotSummaries = useMemo(() => summarizeProRobots(slots, snapshots), [slots, snapshots]);
  const offerReadyRobots = useMemo(
    () => selectOfferReadyRobots(slots, robotSummaries, snapshots),
    [robotSummaries, slots, snapshots]
  );
  const offerPresets = useMemo(() => activeOfferPresets(portableManifest), [portableManifest]);
  const fleetFull = Boolean(manifest && !hasGarageRobotCapacity(manifest));
  const filteredTrades = useMemo(() => trades.filter((snapshot) => matchesFilter(snapshot, filter)), [filter, trades]);
  const filteredRewardSlots = rewardSlotsForFilter(rewardSlots, filter);
  const counts = useMemo(() => summaryCounts(trades, rewardSlots.length), [rewardSlots.length, trades]);
  const fleetProtection = useMemo(
    () => fleetProtectionPresentation(vaultSyncStatus, pendingFleetChanges, synchronizedFleetRecords),
    [pendingFleetChanges, synchronizedFleetRecords, vaultSyncStatus]
  );
  const displayCoordinators = useMemo(
    () =>
      coordinators.filter((coordinator) => coordinator.shortAlias !== "local").sort(compareCoordinatorsByEstablished),
    [coordinators]
  );
  const settingsSlot = slots.find((slot) => slot.tokenSHA256 === settingsSlotId);
  const backupSlot = slots.find((slot) => slot.tokenSHA256 === backupSlotId);
  const telegramSlot = slots.find((slot) => slot.tokenSHA256 === telegramSlotId);
  const deleteSlot = slots.find((slot) => slot.tokenSHA256 === deleteSlotId);
  const settingsCoordinator = displayCoordinators.find((coordinator) => coordinator.shortAlias === settingsAlias);
  const settingsRobot =
    settingsCoordinator && settingsSlot ? settingsSlot.robots[settingsCoordinator.shortAlias] : undefined;

  const closeTrade = useCallback(() => {
    setSelectedTrade(undefined);
    void garageReconciler.reconcileAll("order-action");
  }, []);
  const dismissActionNotice = useCallback(() => setActionNotice(undefined), []);

  if (!enabled) return <Navigate to="/garage" replace />;
  if (vaultStatus === "idle" || vaultStatus === "loading" || !hydrated) {
    return (
      <main className="page page-narrow pro-workspace-page">
        <AppTransitionFeedback title="Opening Pro Desk" message="Loading your Fleet and trade overview..." />
      </main>
    );
  }

  function selectView(view: ProView) {
    setLastView(view);
  }

  function selectSummaryFilter(next: Exclude<ProFilter, "all">) {
    setLastView("trades");
    setFilter(filter === next ? "all" : next);
  }

  function openGuidedTrade() {
    setGuidedTradeOpen(true);
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
    setGuidedTradeOpen(false);
    setPendingCreatePrefill({
      type: criteria.intent === "buy" ? 0 : 1,
      currency: currencyIdFromCode(criteria.currency),
      amount: String(criteria.amount),
      paymentMethod: criteria.paymentMethod
    });
    setCreatePickerOpen(true);
  }

  function reviewGuidedOffer(order: PublicOrder, criteria: GuidedTradeCriteria) {
    navigate("/offers", {
      state: {
        guidedTradeLaunch: {
          criteria,
          returnTo: "/pro",
          reviewOrder: order
        }
      }
    });
  }

  function startCreateOffer(
    slotId: string,
    presetId?: string,
    prefillDraft?: Pick<CreateOrderDraft, "amount" | "currency" | "paymentMethod" | "type">
  ) {
    const slot = useGarageStore.getState().slots.find((item) => item.tokenSHA256 === slotId);
    if (!slot) return;
    const tradeIndex = useProTradeIndexStore.getState();
    const lifecycle = deriveProRobotLifecycle(slot, tradeIndex.snapshots, tradeIndex.syncBySlot[slotId]);
    if (!lifecycle.canStartOrder) {
      setAnnouncement(`${slot.nickname} is not available for another order.`);
      return;
    }
    if (shouldRefreshRobotStatus(proRobotStatusTimestamp(syncBySlot[slotId]))) {
      void garageReconciler.reconcileSlot(slotId, "order-action");
    }
    setCurrentToken(slot.token);
    navigate("/create", {
      state: {
        creatingOfferAs: { hashId: slot.hashId, nickname: slot.nickname },
        robotSlotId: slot.tokenSHA256,
        presetId,
        prefillDraft
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
    const {
      id: _id,
      revision: _revision,
      deviceId: _deviceId,
      deleted: _deleted,
      updatedAt: _updatedAt,
      ...input
    } = preset;
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

  function openRobotTrade(slotId: string) {
    const snapshot = trades.find((trade) => trade.locator.slotId === slotId);
    if (snapshot) {
      openTrade(snapshot.locator);
      return;
    }

    const slot = slots.find((item) => item.tokenSHA256 === slotId);
    const coordinatorOrder = slot
      ? Object.entries(slot.robots).find(
          ([alias, robot]) => alias !== "local" && Boolean(robot.activeOrderId || robot.renewableOrderId)
        )
      : undefined;
    const orderId =
      coordinatorOrder?.[1].activeOrderId ?? coordinatorOrder?.[1].renewableOrderId ?? slot?.activeOrderId;
    if (slot && coordinatorOrder && orderId) {
      openTrade({ slotId, shortAlias: coordinatorOrder[0], orderId });
      return;
    }

    setAnnouncement(`${slot?.nickname ?? "This robot"}'s trade is still being loaded.`);
    void garageReconciler.reconcileSlot(slotId, "order-action");
  }

  function replaceSelectedTrade(locator: { shortAlias: string; orderId: number }) {
    if (!selectedTrade) return;
    const nextLocator = { ...selectedTrade, ...locator };
    if (selectedTrade.shortAlias !== nextLocator.shortAlias || selectedTrade.orderId !== nextLocator.orderId) {
      removeTrade(selectedTrade);
    }
    setSelectedTrade(nextLocator);
  }

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

  async function addRobotQuickly(): Promise<string | undefined> {
    setAddingRobot(true);
    try {
      const entry = await createDerivedRobot();
      const token = entry.token;
      const identity = deriveRobotIdentity(token);
      const fallbackName = `Robot ${identity.hashId.slice(0, 8)}`;
      addSlot({
        ...identity,
        nickname: fallbackName,
        managedBy: "fleet",
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
      setActionNotice({
        id: ++actionNoticeSequence.current,
        title: "Robot added",
        detail: fallbackName,
        robot: { slotId: identity.tokenSHA256, hashId: identity.hashId, nickname: fallbackName }
      });
      setAnnouncement("New robot added.");

      void import("@/domains/identity/roboavatarClient")
        .then(({ prewarmRobotAvatar }) => prewarmRobotAvatar(identity.hashId))
        .catch(() => undefined);

      void import("@/domains/identity/robonameClient")
        .then(({ generateRoboname }) => {
          const nickname = generateRoboname(identity.hashId);
          updateSlotIdentityDetails(token, { nickname });
          void renameVaultRobot(token, nickname);
          setActionNotice((current) =>
            current?.robot?.slotId === identity.tokenSHA256
              ? { ...current, detail: nickname, robot: { ...current.robot, nickname } }
              : current
          );
        })
        .catch(() => undefined);
      window.setTimeout(() => {
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
      }, 600);
      return identity.tokenSHA256;
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : "Could not add robot.");
      return undefined;
    } finally {
      setAddingRobot(false);
    }
  }

  async function requestRobotCreation(): Promise<string | undefined> {
    try {
      if (vaultStatus === "idle" || vaultStatus === "loading") {
        await initializeVault();
      }
      if (useGarageVaultStore.getState().status !== "ready") {
        setGarageSetupOpen(true);
        return undefined;
      }
      if (fleetFull) {
        setAnnouncement(FLEET_ROBOT_LIMIT_MESSAGE);
        return undefined;
      }
      return addRobotQuickly();
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : "Could not prepare a fresh robot.");
      return undefined;
    }
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
      for (const slot of slots) {
        if (slot.managedBy === "fleet") removeSlot(slot.token);
      }
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
      setActionNotice({
        id: ++actionNoticeSequence.current,
        title: `Offer ${result}`,
        detail: `#${snapshot.locator.orderId} · ${slot.nickname}`
      });
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
        setActionNotice({
          id: ++actionNoticeSequence.current,
          title: "Offer already cancelled",
          detail: `#${snapshot.locator.orderId} · ${slot.nickname}`
        });
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
    const tradeIndex = useProTradeIndexStore.getState();
    const lifecycle = deriveProRobotLifecycle(slot, tradeIndex.snapshots, tradeIndex.syncBySlot[slotId]);
    if (!lifecycle.canRemove) {
      setDeleteSlotId(undefined);
      setAnnouncement(lifecycle.availability.message ?? `${slot.nickname} cannot be removed while it has an order.`);
      return;
    }
    try {
      await removeVaultRobot(slot.token);
      if (slot.managedBy === "fleet") removeSlot(slot.token);
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

  async function refresh() {
    if (manualRefreshing) return;
    setManualRefreshing(true);
    setAnnouncement("Refreshing trade desk");
    const reconciliation = garageReconciler.reconcileAll("manual");
    try {
      const outcome = await settleRefreshInForeground(reconciliation, MANUAL_REFRESH_FOREGROUND_MS);
      setAnnouncement(
        outcome === "complete"
          ? "Trade Desk refreshed"
          : outcome === "failed"
            ? "Some trade statuses could not be refreshed"
            : "Latest available statuses shown. Slower coordinator checks continue in the background."
      );
    } finally {
      setManualRefreshing(false);
    }
  }

  const FleetProtectionIcon = fleetProtection.tone === "synced" ? ShieldCheck : CloudUpload;

  return (
    <main className="page page-wide pro-workspace-page">
      <header className="pro-workspace-header">
        <div className="pro-workspace-heading">
          <p className="app-eyebrow">Pro mode</p>
          <h2>Trade Desk</h2>
          <div className="pro-workspace-context">
            <span className="pro-fleet-sync-status" data-tone={fleetProtection.tone}>
              <span className="pro-fleet-sync-copy" role="status" aria-live="polite" aria-label={fleetProtection.label}>
                <FleetProtectionIcon
                  className={fleetProtection.tone === "syncing" ? "pro-fleet-sync-icon-active" : undefined}
                  size={14}
                  aria-hidden="true"
                />
                <strong>{fleetProtection.label}</strong>
              </span>
              <InfoHint title={fleetProtection.detail} />
            </span>
          </div>
        </div>
        <div className="pro-workspace-commands">
          <Button
            aria-label="Refresh trade desk"
            disabled={manualRefreshing || !hydrated}
            className="pro-refresh-button"
            onClick={() => void refresh()}
            size="icon"
            title="Refresh"
            variant="outline"
          >
            <RefreshCw
              className={manualRefreshing ? "pro-refresh-icon pro-refresh-icon-active" : "pro-refresh-icon"}
              size={17}
            />
          </Button>
          {lastView !== "robots" ? (
            <Button
              aria-label="Create an offer"
              className="pro-create-offer-button"
              onClick={() => setCreatePickerOpen(true)}
              variant="outline"
            >
              <CirclePlus size={18} />
              <span className="pro-header-action-long">Create offer</span>
              <span className="pro-header-action-short">Offer</span>
            </Button>
          ) : (
            <Button
              aria-label={fleetFull ? `Fleet is full at ${GARAGE_LIMITS.activeRobots} robots` : "Add robots"}
              className="pro-add-robot-button"
              disabled={fleetFull}
              loading={addingRobot}
              onClick={() => void requestRobotCreation()}
              title={fleetFull ? FLEET_ROBOT_LIMIT_MESSAGE : "Add robots"}
              variant="outline"
            >
              <AddRobotGlyph size={18} />
              <span>{fleetFull ? "Fleet full" : "Add Robots"}</span>
            </Button>
          )}
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {actionNotice ? (
        <ProActionNotice
          detail={actionNotice.detail}
          noticeKey={actionNotice.id}
          onClose={dismissActionNotice}
          robot={actionNotice.robot}
          title={actionNotice.title}
        />
      ) : null}
      {!garageRecoveryOpen && (garageSetupOpen || vaultStatus === "unconfigured" || vaultStatus === "needs-backup") ? (
        <GarageSetupDialog
          onComplete={finishFleetSetup}
          onRestore={openFleetRecovery}
          onUseStandardGarage={useStandardGarage}
        />
      ) : null}
      {garageRecoveryOpen ? (
        <GarageRecoveryDialog onClose={() => setGarageRecoveryOpen(false)} onRestored={finishFleetSetup} />
      ) : null}

      <section className="pro-summary-strip" aria-label="Trade summary">
        {summaryItems.map((item) => {
          const Icon = item.icon;
          const selected = filter === item.key && lastView === "trades";
          const stale = summaryHasStale(trades, item.key);
          const count = counts[item.key];
          const className = [
            "pro-summary-item",
            `pro-summary-item-${item.key}`,
            count > 0 ? "has-value" : "is-zero",
            selected ? "active" : ""
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              className={className}
              key={item.key}
              type="button"
              aria-pressed={selected}
              onClick={() => selectSummaryFilter(item.key)}
            >
              <Icon size={17} aria-hidden="true" />
              <strong>{count}</strong>
              <span>
                {item.label}
                {stale ? <small>Stale</small> : null}
              </span>
            </button>
          );
        })}
      </section>

      <section className="pro-workspace-surface">
        <header className="pro-workspace-toolbar">
          <Tabs
            ariaLabel="Trade Desk view"
            className="pro-view-tabs"
            id="pro-view"
            onChange={selectView}
            options={[
              {
                value: "trades",
                label: (
                  <>
                    <ListChecks size={16} aria-hidden="true" /> Trades
                  </>
                ),
                ariaLabel: "Trades",
                hint: "Live, public and renewable orders across your Robot Fleet."
              },
              {
                value: "robots",
                label: (
                  <>
                    <FleetGlyph size={16} /> Robot Fleet
                  </>
                ),
                ariaLabel: "Robot Fleet",
                hint: "Your RoboSats robot identities. Each robot can hold one order at a time."
              },
              {
                value: "history",
                label: (
                  <>
                    <History size={16} aria-hidden="true" /> History
                  </>
                ),
                ariaLabel: "History",
                hint: "Completed trades and collaborative cancellations synced with your Fleet."
              }
            ]}
            panelId="pro-workspace-content"
            value={lastView}
          />
        </header>

        <div
          id="pro-workspace-content"
          className="pro-workspace-content"
          role="tabpanel"
          aria-labelledby={tabId("pro-view", lastView)}
          aria-busy={manualRefreshing}
        >
          {lastView === "trades" ? (
            <TradeList
              coordinators={coordinators}
              onCreate={() => setCreatePickerOpen(true)}
              onFindTrade={openGuidedTrade}
              onOpen={openTrade}
              onCancel={setCancelTrade}
              onPause={(snapshot) => void runQuickTradeAction(snapshot, "pause")}
              onClaimRewards={setRewardSlotId}
              onResume={(snapshot) => void runQuickTradeAction(snapshot, "resume")}
              quickActionKey={quickActionKey}
              rewardSlots={filteredRewardSlots}
              snapshots={filteredTrades}
            />
          ) : lastView === "history" ? (
            <HistoryList coordinators={coordinators} entries={tradeHistory?.entries ?? []} />
          ) : (
            <RobotList
              onAddRobot={() => void requestRobotCreation()}
              onCreate={startCreateOffer}
              onDelete={setDeleteSlotId}
              onDownload={(slotId) => {
                const slot = slots.find((item) => item.tokenSHA256 === slotId);
                if (slot) downloadRobotTokenBackup(slot.token, slot.nickname);
              }}
              onOpenTrade={openRobotTrade}
              onSettings={openRobotSettings}
              onTelegram={setTelegramSlotId}
              slots={slots}
              snapshots={snapshots}
              summaries={robotSummaries}
              syncBySlot={syncBySlot}
            />
          )}
        </div>
      </section>

      {guidedTradeOpen ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              message="Loading the guided trade steps..."
              onClose={() => setGuidedTradeOpen(false)}
              title="Preparing trade finder"
            />
          }
        >
          <LazyBeginnerTradeWizard
            coordinators={displayCoordinators}
            loading={(guidedOrdersLoading || guidedOrdersRefreshing) && guidedOrders.length === 0}
            onClose={() => setGuidedTradeOpen(false)}
            onCreateOffer={createGuidedOffer}
            onSelectOffer={reviewGuidedOffer}
            orders={guidedOrders}
          />
        </Suspense>
      ) : null}

      {vaultStatus === "ready" ? (
        <div className="garage-utility-bar pro-fleet-utility-bar" aria-label="Fleet controls">
          <button
            className="garage-utility-btn pro-fleet-utility-primary"
            type="button"
            onClick={() => setFleetKeyOpen(true)}
          >
            <KeyRound size={18} /> <span>Back up Fleet</span>
          </button>
          <button
            className="garage-utility-btn pro-fleet-utility-secondary"
            type="button"
            onClick={() => setPresetsOpen(true)}
          >
            <BookmarkCheck size={18} /> <span>Offer presets</span>
          </button>
          <button
            className="garage-utility-btn pro-fleet-utility-tertiary"
            type="button"
            onClick={() => setAbandonFleetOpen(true)}
          >
            <LogOut size={18} /> <span>Abandon Fleet</span>
          </button>
        </div>
      ) : null}

      {selectedTrade ? (
        <Dialog
          ariaLabel={`Order ${selectedTrade.orderId}`}
          onClose={closeTrade}
          overlayClassName="pro-trade-dialog-overlay"
          panelClassName="pro-trade-dialog"
        >
          <button className="take-modal-close" onClick={closeTrade} type="button" aria-label="Close trade">
            <X size={20} />
          </button>
          <Suspense
            fallback={
              <AppTransitionFeedback compact title="Preparing trade" message="Loading the private trade controls..." />
            }
          >
            <LazyOrderPage
              embeddedLocator={selectedTrade}
              onEmbeddedClose={closeTrade}
              onEmbeddedOrderChange={replaceSelectedTrade}
            />
          </Suspense>
        </Dialog>
      ) : null}

      {createPickerOpen && vaultStatus === "ready" ? (
        <CreateOfferRobotPicker
          onAddRobot={requestRobotCreation}
          addingRobot={addingRobot}
          fleetFull={fleetFull}
          onClose={() => {
            setCreatePickerOpen(false);
            setPendingCreatePrefill(undefined);
            setPendingPresetId(undefined);
          }}
          onSelect={(slotId) => {
            setCreatePickerOpen(false);
            startCreateOffer(slotId, pendingPresetId, pendingCreatePrefill);
            setPendingCreatePrefill(undefined);
            setPendingPresetId(undefined);
          }}
          robots={offerReadyRobots}
        />
      ) : null}

      {settingsSlot ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              message="Loading local robot controls..."
              onClose={closeRobotSettings}
              title="Preparing robot settings"
            />
          }
        >
          <LazyRobotSettingsDialog
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
        </Suspense>
      ) : null}

      {settingsCoordinator && settingsSlot ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              message={`Loading ${settingsCoordinator.longAlias}...`}
              onClose={() => setSettingsAlias(undefined)}
              title="Preparing coordinator robot"
            />
          }
        >
          <LazyRobotCoordinatorDialog
            coordinator={settingsCoordinator}
            onClose={() => setSettingsAlias(undefined)}
            robot={settingsRobot}
            slot={settingsSlot}
          />
        </Suspense>
      ) : null}

      <ProRewardClaimDialog
        coordinators={displayCoordinators}
        onClose={() => setRewardSlotId(undefined)}
        slotId={rewardSlotId}
        slots={slots}
      />

      {backupSlot ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              message="Loading the local backup controls..."
              onClose={() => setBackupSlotId(undefined)}
              title="Preparing token backup"
            />
          }
        >
          <LazyRobotTokenBackupDialog
            onClose={() => setBackupSlotId(undefined)}
            robotName={backupSlot.nickname}
            token={backupSlot.token}
          />
        </Suspense>
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
        <Suspense
          fallback={
            <AppTransitionDialog
              message="Loading the notification setup..."
              onClose={() => setTelegramTarget(undefined)}
              title="Preparing Telegram"
            />
          }
        >
          <LazyTelegramSetupDialog
            botName={telegramTarget.botName}
            token={telegramTarget.token}
            onClose={() => setTelegramTarget(undefined)}
          />
        </Suspense>
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
          onRemove={(id) => {
            removePreset(id);
            setAnnouncement("Offer preset removed.");
          }}
          onUse={useOfferPreset}
          presets={offerPresets}
        />
      ) : null}

      {abandonFleetOpen ? (
        <Dialog
          ariaLabelledby="abandon-fleet-title"
          closeOnEscape={!abandoningFleet}
          onClose={() => {
            if (!abandoningFleet) setAbandonFleetOpen(false);
          }}
          overlayClassName="confirm-overlay"
          panelClassName="confirm-sheet pro-abandon-fleet-sheet"
        >
          <div>
            <h3 id="abandon-fleet-title">Abandon Fleet?</h3>
          </div>
          <p>
            This removes the Fleet key and every associated robot from this device. It does not cancel coordinator
            orders. Robot identities can also be restored individually with their own tokens.
          </p>
          <div className="pro-abandon-fleet-actions">
            <Button
              variant="outline"
              onClick={() => {
                setAbandonFleetOpen(false);
                setFleetKeyOpen(true);
              }}
            >
              <KeyRound size={17} /> Back up Fleet
            </Button>
            <Button loading={abandoningFleet} variant="destructive" onClick={() => void abandonFleetNow()}>
              <LogOut size={17} /> Abandon Fleet
            </Button>
            <Button disabled={abandoningFleet} variant="ghost" onClick={() => setAbandonFleetOpen(false)}>
              Keep Fleet
            </Button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}

function rewardSlotsForFilter(slots: RobotSlot[], filter: ProFilter): RobotSlot[] {
  return filter === "all" || filter === "needs-action" ? slots : [];
}

function ProRewardClaimDialog({
  coordinators,
  onClose,
  slotId,
  slots
}: {
  coordinators: CoordinatorSummary[];
  onClose: () => void;
  slotId?: string;
  slots: RobotSlot[];
}) {
  const slot = slots.find((item) => item.tokenSHA256 === slotId);
  if (!slot) return null;
  return (
    <Suspense
      fallback={
        <AppTransitionDialog message="Loading the claim controls..." onClose={onClose} title="Preparing rewards" />
      }
    >
      <LazyRewardWithdrawalDialog coordinators={coordinators} onClose={onClose} slot={slot} />
    </Suspense>
  );
}

async function settleRefreshInForeground(
  refresh: Promise<void>,
  timeoutMs: number
): Promise<"complete" | "continuing" | "failed"> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completion = refresh.then(
    () => "complete" as const,
    () => "failed" as const
  );
  const foregroundBudget = new Promise<"continuing">((resolve) => {
    timeout = setTimeout(() => resolve("continuing"), timeoutMs);
  });
  const outcome = await Promise.race([completion, foregroundBudget]);
  if (timeout) clearTimeout(timeout);
  return outcome;
}
