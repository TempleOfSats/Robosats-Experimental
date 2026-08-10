import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PropsWithChildren } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import type { RoboSatsPlatform } from "@/app/platform";
import {
  beginRouteTransition,
  isMatchingRouteTransition,
  normalizeRoutePath,
  ROUTE_TRANSITION_READY_EVENT,
  ROUTE_TRANSITION_START_EVENT,
  type RouteTransitionDetail
} from "@/domains/navigation/routeTransition";
import { AppSidebar } from "@/components/app/AppSidebar";
import { AppTransitionFeedback } from "@/domains/navigation/AppTransitionFeedback";
import { DesktopTitleBar } from "@/components/app/DesktopTitleBar";
import { isTauriDesktop } from "@/domains/transport/tauriBridge";

export function AppShell({ children, platform }: PropsWithChildren<{ platform: RoboSatsPlatform }>) {
  const desktop = isTauriDesktop();
  const location = useLocation();
  const navigationType = useNavigationType();
  const currentPath = useRef(normalizeRoutePath(location.pathname));
  const routeScroll = useRef({
    key: location.key,
    path: currentPath.current,
    positions: new Map<string, number>()
  });
  const pendingScrollRestore = useRef<{ path: string; top: number } | undefined>(undefined);
  const [routeTransition, setRouteTransition] = useState<RouteTransitionDetail>();

  useLayoutEffect(() => {
    const nextPath = normalizeRoutePath(location.pathname);
    const scroll = routeScroll.current;
    if (scroll.key === location.key) {
      currentPath.current = nextPath;
      return;
    }

    scroll.positions.set(scroll.key, window.scrollY);
    const top = navigationType === "POP" ? (scroll.positions.get(location.key) ?? 0) : 0;
    pendingScrollRestore.current = {
      path: nextPath,
      top
    };
    const samePath = scroll.path === nextPath;
    scroll.key = location.key;
    scroll.path = nextPath;
    currentPath.current = nextPath;
    window.scrollTo(0, 0);
    if (samePath) {
      window.scrollTo(0, top);
      pendingScrollRestore.current = undefined;
    }
  }, [location.key, location.pathname, navigationType]);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    let feedbackTimer: number | undefined;
    let safetyTimer: number | undefined;
    let pendingTransition: RouteTransitionDetail | undefined;
    const clearTimers = () => {
      if (feedbackTimer !== undefined) window.clearTimeout(feedbackTimer);
      if (safetyTimer !== undefined) window.clearTimeout(safetyTimer);
      feedbackTimer = undefined;
      safetyTimer = undefined;
    };
    const settle = (path: string) => {
      const pendingScroll = pendingScrollRestore.current;
      if (pendingScroll && isMatchingRouteTransition(pendingScroll.path, path)) {
        window.scrollTo(0, pendingScroll.top);
        pendingScrollRestore.current = undefined;
      }
      if (!pendingTransition) return;
      if (!isMatchingRouteTransition(pendingTransition.path, path)) {
        if (!isMatchingRouteTransition(currentPath.current, path)) return;
      }
      clearTimers();
      pendingTransition = undefined;
      setRouteTransition(undefined);
    };
    const start = (event: Event) => {
      const detail = (event as CustomEvent<RouteTransitionDetail>).detail;
      if (!detail || normalizeRoutePath(detail.path) === currentPath.current) return;
      clearTimers();
      pendingTransition = detail;
      setRouteTransition(undefined);
      feedbackTimer = window.setTimeout(() => {
        feedbackTimer = undefined;
        if (pendingTransition && isMatchingRouteTransition(pendingTransition.path, detail.path)) {
          setRouteTransition(detail);
        }
      }, 180);
      safetyTimer = window.setTimeout(() => {
        clearTimers();
        pendingTransition = undefined;
        setRouteTransition(undefined);
      }, 90_000);
    };
    const ready = (event: Event) => {
      const path = (event as CustomEvent<{ path: string }>).detail?.path;
      if (!path) return;
      settle(path);
    };
    window.addEventListener(ROUTE_TRANSITION_START_EVENT, start);
    window.addEventListener(ROUTE_TRANSITION_READY_EVENT, ready);
    return () => {
      clearTimers();
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
