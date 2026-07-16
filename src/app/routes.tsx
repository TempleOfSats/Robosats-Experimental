import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLoadingSkeleton } from "@/components/app/AppLoadingWheel";

const RobotGaragePage = lazy(() => import("@/domains/garage/RobotGaragePage").then((module) => ({ default: module.RobotGaragePage })));
const OffersPage = lazy(() => import("@/domains/orderbook/OffersPage").then((module) => ({ default: module.OffersPage })));
const CreateOrderPage = lazy(() => import("@/domains/maker/CreateOrderPage").then((module) => ({ default: module.CreateOrderPage })));
const CoordinatorsPage = lazy(() => import("@/domains/coordinators/CoordinatorsPage").then((module) => ({ default: module.CoordinatorsPage })));
const OrderPage = lazy(() => import("@/domains/orders/OrderPage").then((module) => ({ default: module.OrderPage })));
const SettingsPage = lazy(() => import("@/domains/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));
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
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/garage" replace />} />
        <Route path="/garage/:token?" element={<RobotGaragePage />} />
        <Route path="/offers" element={<OffersPage />} />
        <Route path="/create" element={<CreateOrderPage />} />
        <Route path="/coordinators" element={<CoordinatorsPage />} />
        <Route path="/order/:shortAlias/:orderId" element={<OrderPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {TradeLabPage ? <Route path="/__dev/trade-lab" element={<TradeLabPage />} /> : null}
        <Route path="*" element={<Navigate to="/garage" replace />} />
      </Routes>
    </Suspense>
  );
}

function RouteFallback() {
  return (
    <main className="page page-narrow">
      <div className="route-fallback" aria-label="Loading">
        <AppLoadingSkeleton />
      </div>
    </main>
  );
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
