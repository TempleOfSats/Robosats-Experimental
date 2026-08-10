import { lazy, Suspense, useEffect, useState } from "react";
import { ALargeSmall, BarChart3, BellRing, BookOpen, ChevronRight, ExternalLink, Info, KeyRound, Link2, Palette, PanelsTopLeft, RadioTower, RefreshCw, Users, WalletCards } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { AppTransitionDialog } from "@/domains/navigation/AppTransitionFeedback";
import { Button } from "@/components/ui/button";
import { RobotIcon } from "@/components/ui/robotIcon";
import { Card, CardContent } from "@/components/ui/card";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { selectCurrentSlot, selectStandardGarageSlots, useGarageStore } from "@/domains/garage/garageStore";
import {
  FONT_SCALE_STEP,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  describeFontScale,
  readUiPreferences,
  saveUiPreferences
} from "@/domains/settings/uiPreferences";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import { useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import {
  OnionIcon,
  TorConnectionDialog,
  torStatusLabel
} from "@/domains/settings/TorConnectionSettings";
import {
  getNativeNotificationState,
  isAndroidApp,
  isIOSApp,
  setNativeNotificationsEnabled,
  type AndroidNotificationState
} from "@/domains/transport/androidBridge";
import {
  getDesktopNotificationState,
  isTauriDesktop,
  setDesktopNotificationsEnabled
} from "@/domains/transport/tauriBridge";
import { useTorConnection } from "@/domains/transport/torConnection";
import "@/domains/pro/proFleet.css";

const GarageRobotSettingsDialog = lazy(() =>
  import("@/domains/garage/RobotGaragePage").then((module) => ({ default: module.RobotSettingsDialog }))
);
const GarageRobotCoordinatorDialog = lazy(() =>
  import("@/domains/garage/RobotGaragePage").then((module) => ({ default: module.RobotCoordinatorDialog }))
);
const GarageRobotTokenBackupDialog = lazy(() =>
  import("@/domains/garage/RobotTokenBackupDialog").then((module) => ({ default: module.RobotTokenBackupDialog }))
);
const GarageRecoveryDialog = lazy(() =>
  import("@/domains/pro/GarageRecoveryDialog").then((module) => ({ default: module.GarageRecoveryDialog }))
);
const GarageSetupDialog = lazy(() =>
  import("@/domains/pro/GarageSetupDialog").then((module) => ({ default: module.GarageSetupDialog }))
);
const FleetKeyDialog = lazy(() =>
  import("@/domains/pro/FleetKeyDialog").then((module) => ({ default: module.FleetKeyDialog }))
);

export function SettingsPage() {
  const navigate = useNavigate();
  const connection = useFederationStore((state) => state.connection);
  const coordinators = useFederationStore((state) => state.coordinators);
  const network = useFederationStore((state) => state.network);
  const setConnection = useFederationStore((state) => state.setConnection);
  const setNetwork = useFederationStore((state) => state.setNetwork);
  const allSlots = useGarageStore((state) => state.slots);
  const slots = selectStandardGarageSlots(allSlots);
  const currentToken = useGarageStore((state) => state.currentToken);
  const hydrateGarage = useGarageStore((state) => state.hydrate);
  const setCurrentToken = useGarageStore((state) => state.setCurrentToken);
  const activeSlot = selectCurrentSlot(slots, currentToken);
  const displayCoordinators = coordinators.filter((coordinator) => coordinator.shortAlias !== "local");
  const [ui, setUi] = useState(readUiPreferences);
  const androidRuntime = isAndroidApp();
  const iosRuntime = isIOSApp();
  const desktopRuntime = isTauriDesktop();
  const nativeRuntime = androidRuntime || iosRuntime || desktopRuntime;
  const [notificationState, setNotificationState] = useState<AndroidNotificationState | null>(null);
  const torConnection = useTorConnection();
  const torDiagnostics = torConnection.diagnostics;
  const [showTorDetails, setShowTorDetails] = useState(false);
  const [showRobotSettings, setShowRobotSettings] = useState(false);
  const [showRobotKeys, setShowRobotKeys] = useState(false);
  const [showRobotTokenBackup, setShowRobotTokenBackup] = useState(false);
  const [selectedRobotCoordinator, setSelectedRobotCoordinator] = useState<string>();
  const [showFleetRecovery, setShowFleetRecovery] = useState(false);
  const [showFleetKey, setShowFleetKey] = useState(false);
  const [preparingPro, setPreparingPro] = useState(false);
  const robotCoordinator = displayCoordinators.find((coordinator) => coordinator.shortAlias === selectedRobotCoordinator);
  const coordinatorRobot = robotCoordinator && activeSlot ? activeSlot.robots[robotCoordinator.shortAlias] : undefined;
  const proEnabled = useProPreferencesStore((state) => state.enabled);
  const proSetupSeen = useProPreferencesStore((state) => state.setupSeen);
  const setProEnabled = useProPreferencesStore((state) => state.setEnabled);
  const markProSetupSeen = useProPreferencesStore((state) => state.markSetupSeen);
  const setProLastView = useProPreferencesStore((state) => state.setLastView);
  const garageVaultStatus = useGarageVaultStore((state) => state.status);
  const initializeGarageVault = useGarageVaultStore((state) => state.initialize);
  const garageSyncStatus = useGarageVaultStore((state) => state.syncStatus);
  const garageLastSyncAt = useGarageVaultStore((state) => state.lastSyncAt);
  const exportFleetToken = useGarageVaultStore((state) => state.exportToken);

  useEffect(() => {
    hydrateGarage();
  }, [hydrateGarage]);

  useEffect(() => {
    if (proEnabled) void initializeGarageVault();
  }, [initializeGarageVault, proEnabled]);

  async function enableProMode() {
    setPreparingPro(true);
    setProEnabled(true);
    if (!proSetupSeen) markProSetupSeen();
    await Promise.allSettled([
      initializeGarageVault(),
      import("@/domains/pro/GarageSetupDialog"),
      import("@/domains/pro/GarageRecoveryDialog"),
      import("@/domains/pro/ProWorkspacePage")
    ]);
    setPreparingPro(false);
  }

  useEffect(() => {
    const refreshUiPreferences = (event: Event) => {
      const next = event instanceof CustomEvent ? event.detail as ReturnType<typeof readUiPreferences> | undefined : undefined;
      setUi(next ?? readUiPreferences());
    };
    window.addEventListener("robosats-ui-preferences", refreshUiPreferences);
    return () => window.removeEventListener("robosats-ui-preferences", refreshUiPreferences);
  }, []);

  useEffect(() => {
    if (!nativeRuntime) return;
    const refresh = () => {
      if (desktopRuntime) {
        void getDesktopNotificationState().then(setNotificationState);
      } else {
        setNotificationState(getNativeNotificationState());
      }
    };
    refresh();
    window.addEventListener("robosats:native-notification-state", refresh);
    return () => window.removeEventListener("robosats:native-notification-state", refresh);
  }, [desktopRuntime, nativeRuntime]);

  return (
    <main className="page page-narrow page-settings">
      <div className="page-heading">
        <h2>Settings</h2>
      </div>

      <div className="settings-stack">
        {nativeRuntime ? (
          <section className="settings-android-panel" aria-label={`${desktopRuntime ? "Desktop" : iosRuntime ? "iOS" : "Android"} privacy settings`}>
            <header className="settings-android-header">
              <span className="settings-onion-mark"><OnionIcon /></span>
              <span>
                <strong>{desktopRuntime ? "Desktop privacy" : iosRuntime ? "iOS privacy" : "Android privacy"}</strong>
                <small>{desktopRuntime ? "Embedded Arti and system notifications" : iosRuntime ? "Embedded Tor transport" : "Native Tor and background alerts"}</small>
              </span>
            </header>
            {androidRuntime || desktopRuntime ? <div className="settings-android-row">
              <BellRing size={19} aria-hidden="true" />
              <span className="settings-android-row-copy">
                <strong>Notifications</strong>
                <small>{notificationState?.enabled && notificationState.permissionGranted ? "Enabled" : "Disabled"}</small>
              </span>
              <button
                className="settings-native-toggle"
                type="button"
                role="switch"
                aria-checked={Boolean(notificationState?.enabled && notificationState.permissionGranted)}
                aria-label={`Enable ${desktopRuntime ? "desktop" : "Android"} notifications`}
                onClick={() => {
                  const enabled = !(notificationState?.enabled && notificationState.permissionGranted);
                  setNotificationState((current) => current ? { ...current, enabled } : current);
                  if (desktopRuntime) {
                    void setDesktopNotificationsEnabled(enabled).catch(() => {
                      void getDesktopNotificationState().then(setNotificationState);
                    });
                  } else {
                    setNativeNotificationsEnabled(enabled);
                  }
                }}
              >
                <span className={`toggle-switch ${notificationState?.enabled && notificationState.permissionGranted ? "toggle-switch-on" : ""}`} aria-hidden="true" />
              </button>
            </div> : null}
            <button
              className="settings-android-row settings-tor-command"
              type="button"
              onClick={() => {
                setShowTorDetails(true);
                void torConnection.refresh();
              }}
            >
              <OnionIcon />
              <span className="settings-android-row-copy">
                <strong>Tor connection</strong>
                <small className={torDiagnostics?.connected ? "settings-tor-connected" : undefined}>
                  {torStatusLabel(torDiagnostics)}
                </small>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </section>
        ) : null}

        <section className="settings-control-panel" aria-label="Application settings">
          <div className="settings-control-row settings-pro-control">
            <PanelsTopLeft className="settings-control-icon" size={20} aria-hidden="true" />
            <div className="settings-control-body settings-toggle-control">
              <span>
                <span className="settings-control-label">Pro Mode</span>
                <small>Manage several robots and active trades from one view.</small>
              </span>
              <button
                className="settings-native-toggle"
                type="button"
                role="switch"
                aria-checked={proEnabled}
                aria-label="Pro Mode"
                onClick={() => {
                  if (proEnabled) {
                    setPreparingPro(false);
                    setShowFleetRecovery(false);
                    setProEnabled(false);
                    return;
                  }
                  void enableProMode();
                }}
              >
                <span className={`toggle-switch ${proEnabled ? "toggle-switch-on" : ""}`} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="settings-control-divider" />

          {proEnabled
          && !preparingPro
          && !showFleetRecovery
          && (garageVaultStatus === "unconfigured" || garageVaultStatus === "needs-backup") ? (
            <Suspense
              fallback={
                <AppTransitionDialog
                  title="Preparing Pro Fleet"
                  message="Opening Fleet setup..."
                />
              }
            >
              <GarageSetupDialog
                onComplete={() => {
                  setProLastView("robots");
                  navigate("/pro");
                }}
                onRestore={() => setShowFleetRecovery(true)}
                onUseStandardGarage={() => setProEnabled(false)}
              />
            </Suspense>
          ) : null}

          {proEnabled && garageVaultStatus === "ready" ? (
            <details className="settings-pro-advanced">
              <summary>PRO advanced</summary>
              <div className="settings-pro-advanced-content">
                <span><strong>Fleet</strong><small>{syncStatusLabel(garageSyncStatus, garageLastSyncAt)}</small></span>
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={garageVaultStatus !== "ready"}
                    loading={garageSyncStatus === "saving"}
                    onClick={() => void import("@/domains/pro/proRuntime")
                      .then(({ syncAllProDataNow }) => syncAllProDataNow(coordinators, { forcePublish: true }))
                      .catch(() => undefined)}
                  >
                    <RefreshCw size={16} /> Sync now
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowFleetKey(true)}><KeyRound size={16} /> Fleet key</Button>
                </div>
              </div>
            </details>
          ) : null}

          {proEnabled ? <div className="settings-control-divider" /> : null}

          <div className="settings-control-row">
            <Palette className="settings-control-icon" size={20} aria-hidden="true" />
            <div className="settings-control-body">
              <span className="settings-control-label">Theme</span>
              <div className="settings-choice-group" aria-label="Theme">
                {(["dark", "light"] as const).map((value) => (
                  <button
                    className={ui.theme === value ? "active" : undefined}
                    key={value}
                    type="button"
                    aria-pressed={ui.theme === value}
                    onClick={() => updateUi({ theme: value })}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="settings-control-row">
            <ALargeSmall className="settings-control-icon" size={21} aria-hidden="true" />
            <span className="settings-control-body settings-scale-control">
              <span className="settings-control-label">Text size</span>
              <input
                type="range"
                min={MIN_FONT_SCALE}
                max={MAX_FONT_SCALE}
                step={FONT_SCALE_STEP}
                value={ui.fontScale}
                aria-label="Text size"
                aria-valuetext={`${Math.round(ui.fontScale * 100)} percent, ${describeFontScale(ui.fontScale)}`}
                onChange={(event) => updateUi({ fontScale: Number(event.target.value) })}
              />
              <span className="settings-scale-labels" aria-hidden="true">
                <span>90%</span><span>95%</span><span>100%</span><span>105%</span><span>110%</span><span>115%</span>
              </span>
            </span>
          </label>

          <div className="settings-control-divider" />

          <div className="settings-control-row">
            <RadioTower className="settings-control-icon" size={20} aria-hidden="true" />
            <div className="settings-control-body">
              <span className="settings-control-label">Public offers</span>
              <div className="settings-choice-group" aria-label="Public offer transport">
                <button className={connection === "api" ? "active" : undefined} type="button" aria-pressed={connection === "api"} onClick={() => setConnection("api")}>API</button>
                <button className={connection === "nostr" ? "active" : undefined} type="button" aria-pressed={connection === "nostr"} onClick={() => setConnection("nostr")}>Nostr</button>
              </div>
            </div>
          </div>

          <div className="settings-control-row">
            <Link2 className="settings-control-icon" size={20} aria-hidden="true" />
            <div className="settings-control-body">
              <span className="settings-control-label">Bitcoin network</span>
              <div className="settings-choice-group" aria-label="Bitcoin network">
                {(["mainnet", "testnet"] as const).map((value) => (
                  <button className={network === value ? "active" : undefined} key={value} type="button" aria-pressed={network === value} onClick={() => setNetwork(value)}>
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="settings-control-divider" />

          <div className="settings-control-row settings-coordinator-control">
            <Users className="settings-control-icon" size={20} aria-hidden="true" />
            <div className="settings-control-body">
              <Link to="/coordinators" className="settings-coordinators-button">
                Coordinators
              </Link>
            </div>
          </div>

          <div className="settings-control-divider" />

          <div className="settings-control-row settings-coordinator-control">
            <RobotIcon className="settings-control-icon" size={20} />
            <div className="settings-control-body">
              <button
                className="settings-coordinators-button"
                type="button"
                disabled={!activeSlot}
                onClick={() => setShowRobotSettings(true)}
              >
                Robot settings
              </button>
            </div>
          </div>
        </section>

        <Card className="settings-resource-card">
          <CardContent>
            <nav className="settings-resource-list" aria-label="RoboSats resources">
              <a className="settings-resource-row" href="https://robosats.org/" target="_blank" rel="noreferrer">
                <Info size={18} />
                <span><strong>RoboSats</strong><small>Project website</small></span>
                <ExternalLink size={15} />
              </a>
              <a className="settings-resource-row" href="https://learn.robosats.com/" target="_blank" rel="noreferrer">
                <BookOpen size={18} />
                <span><strong>Learn RoboSats</strong><small>Guides and protocol documentation</small></span>
                <ExternalLink size={15} />
              </a>
              <a className="settings-resource-row" href="https://learn.robosats.com/contribute/community/" target="_blank" rel="noreferrer">
                <Users size={18} />
                <span><strong>Community</strong><small>Join the RoboSats community</small></span>
                <ExternalLink size={15} />
              </a>
              <details className="settings-resource-disclosure">
                <summary className="settings-resource-row">
                  <WalletCards size={18} />
                  <span><strong>Exchange summary</strong><small>Your local client state</small></span>
                </summary>
                <dl className="settings-client-summary">
                  <div><dt>Robots</dt><dd>{slots.length}</dd></div>
                  <div><dt>Active robot</dt><dd>{activeSlot?.nickname ?? "None"}</dd></div>
                  <div><dt>Coordinators</dt><dd>{coordinators.filter((item) => item.enabled).length} enabled</dd></div>
                </dl>
              </details>
              <Link className="settings-resource-row" to="/statistics">
                <BarChart3 size={18} />
                <span><strong>Statistics</strong><small>Live liquidity and federation market activity</small></span>
                <ChevronRight size={15} />
              </Link>
              <details className="settings-resource-disclosure">
                <summary className="settings-resource-row">
                  <RobotIcon size={18} />
                  <span><strong>Client info</strong><small>Runtime and connection details</small></span>
                </summary>
                <dl className="settings-client-summary">
                  <div><dt>Client</dt><dd>Experimental frontend</dd></div>
                  <div><dt>Orderbook</dt><dd>{connection === "nostr" ? "Nostr" : "API"}</dd></div>
                  <div><dt>Network</dt><dd>{network}</dd></div>
                </dl>
              </details>
            </nav>
            <div className="settings-wordmark">
              <img src="/static/assets/vector/Robosats.svg" alt="" />
              <p>A Simple and Private LN P2P Exchange</p>
            </div>
          </CardContent>
        </Card>
      </div>
      {proEnabled && (preparingPro || garageVaultStatus === "idle" || garageVaultStatus === "loading") ? (
        <AppTransitionDialog
          title="Preparing Pro Fleet"
          message="Opening your private Robot Fleet..."
        />
      ) : null}
      {showFleetRecovery ? (
        <Suspense
          fallback={
            <AppTransitionDialog
              title="Preparing Fleet restore"
              message="Opening the private recovery tool..."
            />
          }
        >
          <GarageRecoveryDialog
            onClose={() => setShowFleetRecovery(false)}
            onRestored={() => {
              setProLastView("robots");
              navigate("/pro");
            }}
          />
        </Suspense>
      ) : null}
      {showFleetKey && garageVaultStatus === "ready" ? (
        <Suspense fallback={<AppTransitionDialog title="Preparing Fleet backup" message="Opening your private Fleet key..." />}>
          <FleetKeyDialog fleetKey={exportFleetToken()} onClose={() => setShowFleetKey(false)} />
        </Suspense>
      ) : null}

      {showTorDetails ? (
        <TorConnectionDialog
          {...torConnection}
          onClose={() => setShowTorDetails(false)}
        />
      ) : null}

      {showRobotSettings && activeSlot ? (
        <Suspense fallback={<AppTransitionDialog title="Preparing robot settings" message="Opening this robot's private controls..." />}>
          <GarageRobotSettingsDialog
            activeToken={activeSlot.token}
            coordinators={displayCoordinators}
            onClose={() => {
              setShowRobotSettings(false);
              setShowRobotKeys(false);
              setSelectedRobotCoordinator(undefined);
            }}
            onCoordinatorSelect={setSelectedRobotCoordinator}
            onTokenBackup={() => setShowRobotTokenBackup(true)}
            onTokenChange={setCurrentToken}
            selectedAlias={selectedRobotCoordinator}
            showKeys={showRobotKeys}
            slot={activeSlot}
            slots={slots}
            toggleKeys={() => setShowRobotKeys((open) => !open)}
          />
        </Suspense>
      ) : null}

      {showRobotTokenBackup && activeSlot ? (
        <Suspense fallback={<AppTransitionDialog title="Preparing token backup" message="Opening this robot's recovery token..." />}>
          <GarageRobotTokenBackupDialog
            onClose={() => setShowRobotTokenBackup(false)}
            robotName={activeSlot.nickname}
            token={activeSlot.token}
          />
        </Suspense>
      ) : null}

      {showRobotSettings && robotCoordinator && activeSlot ? (
        <Suspense fallback={<AppTransitionDialog title="Preparing coordinator details" message="Loading this robot's coordinator state..." />}>
          <GarageRobotCoordinatorDialog
            coordinator={robotCoordinator}
            robot={coordinatorRobot}
            slot={activeSlot}
            onClose={() => setSelectedRobotCoordinator(undefined)}
          />
        </Suspense>
      ) : null}
    </main>
  );

  function updateUi(patch: Partial<typeof ui>) {
    const next = { ...ui, ...patch };
    setUi(next);
    saveUiPreferences(next);
  }
}

function syncStatusLabel(status: "idle" | "saving" | "up-to-date" | "offline", lastSyncAt?: number): string {
  if (status === "saving") return "Saving";
  if (status === "offline") return "Offline, changes will sync";
  if (status !== "up-to-date" || !lastSyncAt) return "Not saved yet";
  return `Up to date · ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(lastSyncAt)}`;
}
