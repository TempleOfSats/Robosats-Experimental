import { useEffect } from "react";
import { BrowserRouter, HashRouter, MemoryRouter } from "react-router-dom";
import { AppShell } from "@/components/app/AppShell";
import { parseRoboSatsSettings } from "@/app/platform";
import { AppRoutes } from "@/app/routes";

export function App() {
  const platform = parseRoboSatsSettings();
  const Router = platform.router === "hash" ? HashRouter : platform.router === "memory" ? MemoryRouter : BrowserRouter;
  const tradeLabContext = isTradeLabContext();

  useEffect(() => {
    window.dispatchEvent(new Event("robosats:app-ready"));

    if (tradeLabContext) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;
    // Keep prewarm off the initial render path.
    const timer = window.setTimeout(() => {
      void import("@/app/prewarm").then(({ scheduleAppPrewarm }) => {
        if (cancelled) return;
        cleanup = scheduleAppPrewarm();
      });
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cleanup?.();
    };
  }, [tradeLabContext]);

  return (
    <Router>
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
