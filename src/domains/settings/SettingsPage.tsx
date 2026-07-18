import { lazy, Suspense, useEffect, useState } from "react";
import { ALargeSmall, BellRing, BookOpen, Bot, ChevronRight, ExternalLink, Info, Link2, Palette, RadioTower, Users, WalletCards, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { selectCurrentSlot, useGarageStore } from "@/domains/garage/garageStore";
import { readUiPreferences, saveUiPreferences } from "@/domains/settings/uiPreferences";
import {
  getNativeNotificationState,
  getNativeTorDiagnostics,
  isAndroidApp,
  isIOSApp,
  setNativeNotificationsEnabled,
  type AndroidNotificationState,
  type AndroidTorDiagnostics
} from "@/domains/transport/androidBridge";
import {
  getDesktopNotificationState,
  getDesktopTorDiagnostics,
  isTauriDesktop,
  retryDesktopTor,
  setDesktopNotificationsEnabled
} from "@/domains/transport/tauriBridge";

const GarageRobotSettingsDialog = lazy(() =>
  import("@/domains/garage/RobotGaragePage").then((module) => ({ default: module.RobotSettingsDialog }))
);
const GarageRobotCoordinatorDialog = lazy(() =>
  import("@/domains/garage/RobotGaragePage").then((module) => ({ default: module.RobotCoordinatorDialog }))
);

export function SettingsPage() {
  const {
    connection,
    coordinators,
    network,
    setConnection,
    setNetwork
  } = useFederationStore();
  const slots = useGarageStore((state) => state.slots);
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
  const [torDiagnostics, setTorDiagnostics] = useState<AndroidTorDiagnostics | null>(null);
  const [showTorDetails, setShowTorDetails] = useState(false);
  const [showRobotSettings, setShowRobotSettings] = useState(false);
  const [showRobotKeys, setShowRobotKeys] = useState(false);
  const [selectedRobotCoordinator, setSelectedRobotCoordinator] = useState<string>();
  const robotCoordinator = displayCoordinators.find((coordinator) => coordinator.shortAlias === selectedRobotCoordinator);
  const coordinatorRobot = robotCoordinator && activeSlot ? activeSlot.robots[robotCoordinator.shortAlias] : undefined;

  useEffect(() => {
    hydrateGarage();
  }, [hydrateGarage]);

  useEffect(() => {
    if (!nativeRuntime) return;
    const refresh = () => {
      if (desktopRuntime) {
        void Promise.all([
          getDesktopNotificationState(),
          getDesktopTorDiagnostics()
        ]).then(([notifications, diagnostics]) => {
          setNotificationState(notifications);
          setTorDiagnostics(diagnostics);
        });
      } else {
        setNotificationState(getNativeNotificationState());
        setTorDiagnostics(getNativeTorDiagnostics());
      }
    };
    refresh();
    window.addEventListener("robosats:native-notification-state", refresh);
    window.addEventListener("robosats:tor-reconnected", refresh);
    return () => {
      window.removeEventListener("robosats:native-notification-state", refresh);
      window.removeEventListener("robosats:tor-reconnected", refresh);
    };
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
                  const enabled = !Boolean(notificationState?.enabled && notificationState.permissionGranted);
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
                if (desktopRuntime) {
                  void getDesktopTorDiagnostics().then(setTorDiagnostics);
                } else {
                  setTorDiagnostics(getNativeTorDiagnostics());
                }
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
                min="0.9"
                max="1.1"
                step="0.05"
                value={ui.fontScale}
                aria-label="Text size"
                onChange={(event) => updateUi({ fontScale: Number(event.target.value) })}
              />
              <span className="settings-scale-labels" aria-hidden="true">
                <span>XS</span><span>S</span><span>M</span><span>L</span><span>XL</span>
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
            <Bot className="settings-control-icon" size={20} aria-hidden="true" />
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
              <details className="settings-resource-disclosure">
                <summary className="settings-resource-row">
                  <Bot size={18} />
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

      {showTorDetails ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="tor-details-title" onClick={() => setShowTorDetails(false)}>
          <section className="confirm-sheet settings-tor-dialog" onClick={(event) => event.stopPropagation()}>
            <header className="settings-tor-dialog-header">
              <span className="settings-onion-mark settings-onion-mark-large"><OnionIcon /></span>
              <span>
                <h3 id="tor-details-title">Tor connection</h3>
                <p>{torStatusLabel(torDiagnostics)}</p>
              </span>
              <Button size="icon" variant="ghost" aria-label="Close Tor details" onClick={() => setShowTorDetails(false)}><X size={18} /></Button>
            </header>
            <div className={`settings-tor-health ${torDiagnostics?.connected ? "connected" : ""}`}>
              <span aria-hidden="true" />
              {torDiagnostics?.connected ? "Traffic is routed through Tor" : "Tor is not ready"}
            </div>
            <dl className="settings-tor-details">
              <div><dt>State</dt><dd>{torDiagnostics?.state ?? "Unavailable"}</dd></div>
              <div><dt>Engine</dt><dd>{torDiagnostics?.implementation ?? "Arti"}</dd></div>
              <div><dt>Arti build</dt><dd>{torDiagnostics?.artiVersion ?? "Unavailable"}</dd></div>
              <div><dt>Native client</dt><dd>{torDiagnostics?.clientInitialized && torDiagnostics.proxyRunning ? "Ready" : "Not ready"}</dd></div>
              <div><dt>SOCKS proxy</dt><dd>{torDiagnostics?.socksHost && torDiagnostics.socksPort ? `${torDiagnostics.socksHost}:${torDiagnostics.socksPort}` : "Not listening"}</dd></div>
              <div><dt>Network</dt><dd>{torDiagnostics?.networkAvailable ? "Available" : "Unavailable"}</dd></div>
              <div><dt>Routing</dt><dd>{torDiagnostics?.routing ?? "Native Tor transport"}</dd></div>
              <div><dt>App</dt><dd>RoboSats Exp. {torDiagnostics?.appVersion ?? ""}</dd></div>
            </dl>
            {torDiagnostics?.error ? <p className="field-error">{torDiagnostics.error}</p> : null}
            <Button
              variant="secondary"
              className="full-width"
              onClick={() => {
                if (desktopRuntime) {
                  void retryDesktopTor()
                    .then(() => getDesktopTorDiagnostics())
                    .then(setTorDiagnostics);
                } else {
                  setTorDiagnostics(getNativeTorDiagnostics());
                }
              }}
            >
              {desktopRuntime && torDiagnostics?.state === "failed" ? "Retry connection" : "Check connection"}
            </Button>
          </section>
        </div>
      ) : null}

      {showRobotSettings && activeSlot ? (
        <Suspense fallback={null}>
          <GarageRobotSettingsDialog
            activeToken={activeSlot.token}
            coordinators={displayCoordinators}
            onClose={() => {
              setShowRobotSettings(false);
              setShowRobotKeys(false);
              setSelectedRobotCoordinator(undefined);
            }}
            onCoordinatorSelect={setSelectedRobotCoordinator}
            onTokenChange={setCurrentToken}
            selectedAlias={selectedRobotCoordinator}
            showKeys={showRobotKeys}
            slot={activeSlot}
            slots={slots}
            toggleKeys={() => setShowRobotKeys((open) => !open)}
          />
        </Suspense>
      ) : null}

      {showRobotSettings && robotCoordinator && activeSlot ? (
        <Suspense fallback={null}>
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

function torStatusLabel(diagnostics: AndroidTorDiagnostics | null): string {
  if (!diagnostics) return "Checking...";
  if (diagnostics.connected) return "Connected";
  if (diagnostics.state === "connecting") return "Connecting...";
  if (diagnostics.state === "failed") return "Connection failed";
  return "Disconnected";
}

function OnionIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3c0 2.3-1.7 3.2-3.4 4.3C6.4 8.7 5 10.6 5 13.2A7 7 0 0 0 19 13c0-2.5-1.4-4.4-3.6-5.8C13.7 6.1 12 5.2 12 3Z" />
      <path d="M12 7.1c0 1.5-1 2.2-2.1 3.1-1.1.8-1.8 1.8-1.8 3.2a3.9 3.9 0 0 0 7.8 0c0-1.4-.7-2.4-1.8-3.2C13 9.3 12 8.6 12 7.1Z" />
      <path d="M12 11.3c-.8.8-1.4 1.4-1.4 2.4a1.4 1.4 0 0 0 2.8 0c0-1-.6-1.6-1.4-2.4Z" />
    </svg>
  );
}
