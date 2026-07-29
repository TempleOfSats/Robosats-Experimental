export const ROUTE_TRANSITION_START_EVENT = "robosats:route-transition-start";
export const ROUTE_TRANSITION_READY_EVENT = "robosats:route-transition-ready";

export type RouteTransitionDetail = {
  path: string;
  title: string;
  message: string;
};

export function beginRouteTransition(path: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent<RouteTransitionDetail>(
      ROUTE_TRANSITION_START_EVENT,
      { detail: routeTransitionDetail(path) }
    ));
  } catch {
    // Transition feedback is progressive enhancement and must never block navigation.
  }
}

export function finishRouteTransition(path: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ path: string }>(
    ROUTE_TRANSITION_READY_EVENT,
    { detail: { path } }
  ));
}

export function routeTransitionDetail(path: string): RouteTransitionDetail {
  const normalized = normalizeRoutePath(path);
  if (normalized === "/offers") {
    return { path: normalized, title: "Opening offers", message: "Loading the public order book..." };
  }
  if (normalized === "/settings") {
    return { path: normalized, title: "Opening settings", message: "Loading your local preferences..." };
  }
  if (normalized === "/statistics") {
    return { path: normalized, title: "Opening statistics", message: "Loading federation market data..." };
  }
  if (normalized === "/create") {
    return { path: normalized, title: "Opening offer builder", message: "Preparing your trade details..." };
  }
  if (normalized === "/pro") {
    return { path: normalized, title: "Opening Pro Desk", message: "Preparing your Robot Fleet..." };
  }
  if (normalized.startsWith("/order/")) {
    return { path: normalized, title: "Opening trade", message: "Connecting to the coordinator..." };
  }
  if (normalized.startsWith("/garage")) {
    return { path: normalized, title: "Opening Garage", message: "Loading your robot locally..." };
  }
  if (normalized === "/coordinators") {
    return { path: normalized, title: "Opening coordinators", message: "Loading federation status..." };
  }
  return { path: normalized, title: "Preparing RoboSats", message: "Loading the private interface..." };
}

export function normalizeRoutePath(path: string): string {
  if (!path) return "/";
  if (path.startsWith("#")) return normalizeRoutePath(path.slice(1));
  try {
    const url = new URL(path, typeof window === "undefined" ? "http://localhost" : window.location.href);
    if (url.hash.startsWith("#/")) return normalizeRoutePath(url.hash.slice(1));
    return url.pathname;
  } catch {
    return path.split(/[?#]/, 1)[0] || "/";
  }
}

export function isMatchingRouteTransition(pendingPath: string, readyPath: string): boolean {
  return normalizeRoutePath(pendingPath) === normalizeRoutePath(readyPath);
}

export function isStandardGarageRoute(path: string): boolean {
  return /^\/garage(?:\/|$)/.test(normalizeRoutePath(path));
}
