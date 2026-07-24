import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppTransitionFeedback } from "@/components/app/AppTransitionFeedback";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";

const RobotGaragePage = lazy(() => import("@/domains/garage/RobotGaragePage").then((module) => ({ default: module.RobotGaragePage })));
const OffersPage = lazy(() => import("@/domains/orderbook/OffersPage").then((module) => ({ default: module.OffersPage })));
const CreateOrderPage = lazy(() => import("@/domains/maker/CreateOrderPage").then((module) => ({ default: module.CreateOrderPage })));
const CoordinatorsPage = lazy(() => import("@/domains/coordinators/CoordinatorsPage").then((module) => ({ default: module.CoordinatorsPage })));
const OrderPage = lazy(() => import("@/domains/orders/OrderPage").then((module) => ({ default: module.OrderPage })));
const SettingsPage = lazy(() => import("@/domains/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const ProWorkspacePage = lazy(() => import("@/domains/pro/ProWorkspacePage").then((module) => ({ default: module.ProWorkspacePage })));
const TradeLabPage = (import.meta.env.DEV || import.meta.env.VITE_ENABLE_TRADE_LAB === "true")
  ? lazy(() => import("@/dev/TradeLabPage").then((module) => ({ default: module.TradeLabPage })))
  : null;

export function preloadPrimaryTradeRoutes(): void {
  void preloadOffersRoute();
  void preloadCreateOrderRoute();
}

export function preloadAllAppRoutes(): void {
  void preloadGarageRoute();
  void preloadOffersRoute();
  void preloadCreateOrderRoute();
  void preloadCoordinatorsRoute();
  void preloadOrderRoute();
  void preloadSettingsRoute();
  if (useProPreferencesStore.getState().enabled) void preloadProRoute();
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/garage/:token?" element={<StandardGarageRoute />} />
        <Route path="/offers" element={<ReadyRoute><OffersPage /></ReadyRoute>} />
        <Route path="/create" element={<ReadyRoute><CreateOrderPage /></ReadyRoute>} />
        <Route path="/coordinators" element={<ReadyRoute><CoordinatorsPage /></ReadyRoute>} />
        <Route path="/order/:shortAlias/:orderId" element={<ReadyRoute><OrderPage /></ReadyRoute>} />
        <Route path="/settings" element={<ReadyRoute><SettingsPage /></ReadyRoute>} />
        <Route path="/pro" element={<ReadyRoute><ProWorkspacePage /></ReadyRoute>} />
        {TradeLabPage ? <Route path="/__dev/trade-lab" element={<ReadyRoute><TradeLabPage /></ReadyRoute>} /> : null}
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Suspense>
  );
}

function RootRedirect() {
  const proEnabled = useProPreferencesStore((state) => state.enabled);
  return <Navigate to={proEnabled ? "/pro" : "/garage"} replace />;
}

function StandardGarageRoute() {
  const proEnabled = useProPreferencesStore((state) => state.enabled);
  if (proEnabled) return <Navigate to="/pro" replace />;
  return <ReadyRoute><RobotGaragePage /></ReadyRoute>;
}

function RouteFallback() {
  return (
    <main className="page page-narrow">
      <div className="route-fallback" aria-label="Loading">
        <AppTransitionFeedback
          title="Preparing RoboSats"
          message="Loading the private interface..."
        />
      </div>
    </main>
  );
}

function ReadyRoute({ children }: { children: ReactNode }) {
  useEffect(() => {
    window.dispatchEvent(new Event("robosats:app-ready"));
  }, []);

  return children;
}

function preloadGarageRoute() {
  return import("@/domains/garage/RobotGaragePage");
}

function preloadOffersRoute() {
  return import("@/domains/orderbook/OffersPage");
}

function preloadCreateOrderRoute() {
  return import("@/domains/maker/CreateOrderPage");
}

function preloadCoordinatorsRoute() {
  return import("@/domains/coordinators/CoordinatorsPage");
}

function preloadOrderRoute() {
  return import("@/domains/orders/OrderPage");
}

function preloadSettingsRoute() {
  return import("@/domains/settings/SettingsPage");
}

function preloadProRoute() {
  return import("@/domains/pro/ProWorkspacePage");
}
