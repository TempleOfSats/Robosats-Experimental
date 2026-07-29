import { useEffect, useRef, useState, type MouseEvent, type PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";
import type { RoboSatsPlatform } from "@/app/platform";
import {
  beginRouteTransition,
  isMatchingRouteTransition,
  normalizeRoutePath,
  ROUTE_TRANSITION_READY_EVENT,
  ROUTE_TRANSITION_START_EVENT,
  type RouteTransitionDetail
} from "@/app/routeTransition";
import { AppSidebar } from "@/components/app/AppSidebar";
import { AppTransitionFeedback } from "@/components/app/AppTransitionFeedback";
import { DesktopTitleBar } from "@/components/app/DesktopTitleBar";
import { isTauriDesktop } from "@/domains/transport/tauriBridge";

export function AppShell({ children, platform }: PropsWithChildren<{ platform: RoboSatsPlatform }>) {
  const desktop = isTauriDesktop();
  const location = useLocation();
  const currentPath = useRef(normalizeRoutePath(location.pathname));
  const [routeTransition, setRouteTransition] = useState<RouteTransitionDetail>();

  useEffect(() => {
    currentPath.current = normalizeRoutePath(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    let safetyTimer: number | undefined;
    const clearSafetyTimer = () => {
      if (safetyTimer !== undefined) window.clearTimeout(safetyTimer);
      safetyTimer = undefined;
    };
    const start = (event: Event) => {
      const detail = (event as CustomEvent<RouteTransitionDetail>).detail;
      if (!detail || normalizeRoutePath(detail.path) === currentPath.current) return;
      clearSafetyTimer();
      setRouteTransition(detail);
      safetyTimer = window.setTimeout(() => setRouteTransition(undefined), 90_000);
    };
    const ready = (event: Event) => {
      const path = (event as CustomEvent<{ path: string }>).detail?.path;
      if (!path) return;
      setRouteTransition((pending) => {
        if (!pending || !isMatchingRouteTransition(pending.path, path)) return pending;
        clearSafetyTimer();
        return undefined;
      });
    };
    window.addEventListener(ROUTE_TRANSITION_START_EVENT, start);
    window.addEventListener(ROUTE_TRANSITION_READY_EVENT, ready);
    return () => {
      clearSafetyTimer();
      window.removeEventListener(ROUTE_TRANSITION_START_EVENT, start);
      window.removeEventListener(ROUTE_TRANSITION_READY_EVENT, ready);
    };
  }, []);

  const captureNavigationIntent = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    const href = anchor.getAttribute("href");
    if (!href || (href.startsWith("#") && !href.startsWith("#/"))) return;
    const targetPath = normalizeRoutePath(href);
    if (targetPath === currentPath.current) return;
    beginRouteTransition(targetPath);
  };

  return (
    <div className={desktop ? "app-runtime app-runtime-desktop" : "app-runtime"}>
      {desktop ? <DesktopTitleBar /> : null}
      <div className="app-shell" onClickCapture={captureNavigationIntent}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <AppSidebar platform={platform} />
        <div className="app-main">
          <main id="main-content" className="app-content" tabIndex={-1}>
            {children}
          </main>
          {routeTransition ? (
            <div className="app-route-transition" aria-live="polite">
              <AppTransitionFeedback
                title={routeTransition.title}
                message={routeTransition.message}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
