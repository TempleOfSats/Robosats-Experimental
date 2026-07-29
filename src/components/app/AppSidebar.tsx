import { Info, LayoutList, PlusCircle, Settings, Store, Workflow, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import type { RoboSatsPlatform } from "@/app/platform";
import { preloadAppRoute } from "@/app/routes";
import { RoboSatsLogo } from "@/components/app/RoboSatsLogo";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { RobotIcon } from "@/components/ui/robotIcon";
import { selectFleetManagedSlots, selectStandardGarageSlots, type RobotSlot, useGarageStore } from "@/domains/garage/garageStore";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import { classifyProTrade } from "@/domains/pro/proSelectors";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";

const items = [
  { label: "Robot", to: "/garage", icon: RobotIcon },
  { label: "Offers", to: "/offers", icon: Store },
  { label: "Create", to: "/create", icon: PlusCircle }
];

export function AppSidebar({ platform: _platform }: { platform: RoboSatsPlatform }) {
  const hydrate = useGarageStore((state) => state.hydrate);
  const slots = useGarageStore((state) => state.slots);
  const currentToken = useGarageStore((state) => state.currentToken);
  const proEnabled = useProPreferencesStore((state) => state.enabled);
  const visibleSlots = proEnabled ? selectFleetManagedSlots(slots) : selectStandardGarageSlots(slots);
  const activeSlot = visibleSlots.find((s) => s.token === currentToken) ?? visibleSlots[0];
  const activeTradePath = getActiveTradePath(activeSlot);
  const snapshots = useProTradeIndexStore((state) => state.snapshots);
  const attentionCount = useMemo(
    () => Object.values(snapshots).filter((snapshot) => classifyProTrade(snapshot) === "needs-action").length,
    [snapshots]
  );
  const [unavailableItem, setUnavailableItem] = useState<"robot" | "trade" | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <aside className="app-sidebar">
      <div className="brand-block">
        <RoboSatsLogo />
      </div>

      <nav className={proEnabled ? "sidebar-nav sidebar-nav-pro" : "sidebar-nav"} aria-label="Main navigation">
        {items.map((item) => item.to === "/garage" && proEnabled ? (
          <button
            aria-describedby="standard-garage-disabled-reason"
            className="nav-item nav-item-disabled"
            key={item.to}
            onClick={() => setUnavailableItem("robot")}
            title="Unavailable while Pro Mode is enabled"
            type="button"
          >
            <item.icon size={18} />
            <span>{item.label}</span>
            <span className="sr-only" id="standard-garage-disabled-reason">Open Settings and disable Pro Mode to use the standard Garage.</span>
          </button>
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
            onFocus={() => preloadAppRoute(item.to)}
            onPointerEnter={() => preloadAppRoute(item.to)}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        {proEnabled ? (
          <NavLink
            to="/pro"
            className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
            onFocus={() => preloadAppRoute("/pro")}
            onPointerEnter={() => preloadAppRoute("/pro")}
          >
            <LayoutList size={18} />
            <span>Pro Desk</span>
            {attentionCount > 0 ? (
              <small className="nav-attention-count" aria-label={`${attentionCount} trades need attention`}>{attentionCount}</small>
            ) : null}
          </NavLink>
        ) : null}
        {activeTradePath ? (
          <NavLink
            to={activeTradePath}
            className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
            onFocus={() => preloadAppRoute(activeTradePath)}
            onPointerEnter={() => preloadAppRoute(activeTradePath)}
          >
            <Workflow size={18} />
            <span>Trade</span>
          </NavLink>
        ) : (
          <button
            aria-describedby="trade-disabled-reason"
            className="nav-item nav-item-disabled"
            onClick={() => setUnavailableItem("trade")}
            title="Choose or create an offer first"
            type="button"
          >
            <Workflow size={18} />
            <span>Trade</span>
            <span className="sr-only" id="trade-disabled-reason">Choose or create an offer before opening a trade.</span>
          </button>
        )}
        <NavLink
          to="/settings"
          className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
          onFocus={() => preloadAppRoute("/settings")}
          onPointerEnter={() => preloadAppRoute("/settings")}
        >
          <Settings size={18} />
          <span>Settings</span>
        </NavLink>
      </nav>

      {unavailableItem ? (
        <Dialog
          ariaLabelledby="unavailable-navigation-title"
          onClose={() => setUnavailableItem(null)}
          overlayClassName="confirm-overlay"
          panelClassName="confirm-sheet nav-unavailable-dialog"
        >
          <header className="confirm-header">
            <span className="nav-unavailable-icon" aria-hidden="true"><Info size={20} /></span>
            <div>
              <h3 id="unavailable-navigation-title">
                {unavailableItem === "robot" ? "Standard Garage unavailable" : "No active trade"}
              </h3>
              <p className="muted-copy">
                {unavailableItem === "robot"
                  ? "The standard Garage is unavailable while Pro Mode is enabled. Your robots are managed from the Pro Desk. If you were using any robot in the standard Garage, toggle off Pro Mode from settings to show them again."
                  : "The Trade view becomes available after a robot creates or takes an offer."}
              </p>
            </div>
            <Button
              aria-label="Close information"
              className="nav-unavailable-close"
              data-dialog-initial-focus
              onClick={() => setUnavailableItem(null)}
              size="icon"
              variant="ghost"
            >
              <X size={18} />
            </Button>
          </header>
        </Dialog>
      ) : null}
    </aside>
  );
}

function getActiveTradePath(slot: RobotSlot | undefined): string | undefined {
  if (!slot) return undefined;
  const activeRobot = Object.values(slot.robots).find((robot) => Boolean(robot.activeOrderId));
  const orderId = activeRobot?.activeOrderId ?? slot.activeOrderId;
  if (!orderId) return undefined;
  return `/order/${activeRobot?.shortAlias ?? "local"}/${orderId}`;
}
