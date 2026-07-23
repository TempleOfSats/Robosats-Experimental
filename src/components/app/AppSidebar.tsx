import { LayoutList, PlusCircle, Settings, Store, Workflow } from "lucide-react";
import { useEffect, useMemo } from "react";
import { NavLink } from "react-router-dom";
import type { RoboSatsPlatform } from "@/app/platform";
import { RoboSatsLogo } from "@/components/app/RoboSatsLogo";
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
          <span className="nav-item nav-item-disabled" aria-disabled="true" key={item.to} title="Disable PRO to use the standard Garage">
            <item.icon size={18} />
            <span>{item.label}</span>
          </span>
        ) : (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
            <item.icon size={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        {proEnabled ? (
          <NavLink to="/pro" className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
            <LayoutList size={18} />
            <span>Pro Desk</span>
            {attentionCount > 0 ? (
              <small className="nav-attention-count" aria-label={`${attentionCount} trades need attention`}>{attentionCount}</small>
            ) : null}
          </NavLink>
        ) : null}
        {activeTradePath ? (
          <NavLink to={activeTradePath} className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
            <Workflow size={18} />
            <span>Trade</span>
          </NavLink>
        ) : (
          <span className="nav-item nav-item-disabled" aria-disabled="true">
            <Workflow size={18} />
            <span>Trade</span>
          </span>
        )}
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
          <Settings size={18} />
          <span>Settings</span>
        </NavLink>
      </nav>
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
