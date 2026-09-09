import { useEffect } from "react";
import { BrowserRouter, HashRouter, MemoryRouter } from "react-router-dom";
import { AppShell } from "@/components/app/AppShell";
import { startBackgroundRuntime } from "@/app/backgroundRuntime";
import { parseRoboSatsSettings } from "@/app/platform";
import { AppRoutes } from "@/app/routes";
import { DesktopNotificationRouter } from "@/components/app/DesktopNotificationRouter";
import { INTERFACE_READY_EVENT } from "@/domains/navigation/routeTransition";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";

export function App() {
  const platform = parseRoboSatsSettings();
  const Router = platform.router === "hash" ? HashRouter : platform.router === "memory" ? MemoryRouter : BrowserRouter;
  const tradeLabContext = isTradeLabContext();
  const proEnabled = useProPreferencesStore((state) => state.enabled);

  useEffect(() => {
    if (tradeLabContext) return;

    let stopPrewarm: (() => void) | undefined;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined || stopPrewarm) return;
      // Wait until the first lazy route is mounted. On an onion origin,
      // preloading before this point competes with the page the user opened.
      timer = window.setTimeout(() => {
        timer = undefined;
        stopPrewarm = startBackgroundRuntime(
          () => import("@/app/prewarm"),
          ({ scheduleAppPrewarm }) => scheduleAppPrewarm(),
          "RoboSats could not start its background refresh."
        );
      }, 250);
    };
    window.addEventListener(INTERFACE_READY_EVENT, schedule, { once: true });
    if (document.documentElement.dataset.robosatsAppReady === "true") schedule();

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener(INTERFACE_READY_EVENT, schedule);
      stopPrewarm?.();
    };
  }, [tradeLabContext]);

  useEffect(() => {
    if (tradeLabContext || !proEnabled) return;
    // Fleet synchronization is required work. If its chunk cannot be fetched, the
    // browser will not fetch it again in this document, so the desk says so and
    // waits for a reload the user chooses instead of reporting a fleet nobody is
    // actually syncing.
    return startBackgroundRuntime(
      () => import("@/domains/pro/proRuntime"),
      ({ startProRuntime }) => startProRuntime(),
      "RoboSats could not start Fleet synchronization."
    );
  }, [proEnabled, tradeLabContext]);

  return (
    <Router>
      <DesktopNotificationRouter />
      {tradeLabContext && new URLSearchParams(window.location.search).get("tradeLab") === "1" ? (
        <main id="main-content" className="app-content trade-lab-standalone-preview" tabIndex={-1}><AppRoutes /></main>
      ) : (
        <AppShell platform={platform}>
          <AppRoutes />
        </AppShell>
      )}
    </Router>
  );
}

function isTradeLabContext(): boolean {
  if ((!import.meta.env.DEV && import.meta.env.VITE_ENABLE_TRADE_LAB !== "true") || typeof window === "undefined") return false;
  return window.location.pathname === "/__dev/trade-lab" || new URLSearchParams(window.location.search).has("tradePreview");
}
