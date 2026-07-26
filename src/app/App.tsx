import { useEffect } from "react";
import { BrowserRouter, HashRouter, MemoryRouter } from "react-router-dom";
import { AppShell } from "@/components/app/AppShell";
import { parseRoboSatsSettings } from "@/app/platform";
import { AppRoutes } from "@/app/routes";
import { DesktopNotificationRouter } from "@/components/app/DesktopNotificationRouter";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";

export function App() {
  const platform = parseRoboSatsSettings();
  const Router = platform.router === "hash" ? HashRouter : platform.router === "memory" ? MemoryRouter : BrowserRouter;
  const tradeLabContext = isTradeLabContext();
  const proEnabled = useProPreferencesStore((state) => state.enabled);

  useEffect(() => {
    if (tradeLabContext) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined || cleanup) return;
      // Wait until the first lazy route is mounted. On an onion origin,
      // preloading before this point competes with the page the user opened.
      timer = window.setTimeout(() => {
        void import("@/app/prewarm").then(({ scheduleAppPrewarm }) => {
          if (cancelled) return;
          cleanup = scheduleAppPrewarm();
        });
      }, 250);
    };
    window.addEventListener("robosats:app-ready", schedule, { once: true });
    if (document.documentElement.dataset.robosatsAppReady === "true") schedule();

    return () => {
      cancelled = true;
      window.removeEventListener("robosats:app-ready", schedule);
      if (timer !== undefined) window.clearTimeout(timer);
      cleanup?.();
    };
  }, [tradeLabContext]);

  useEffect(() => {
    if (tradeLabContext || !proEnabled) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("@/domains/pro/proRuntime").then(({ startProRuntime }) => {
      if (!cancelled) stop = startProRuntime();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [proEnabled, tradeLabContext]);

  return (
    <Router>
      <DesktopNotificationRouter />
      {tradeLabContext && new URLSearchParams(window.location.search).get("tradeLab") === "1" ? (
        <div id="main-content" className="app-content trade-lab-standalone-preview"><AppRoutes /></div>
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
