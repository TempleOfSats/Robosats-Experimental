import { Bot, PlusCircle, Settings, Store, Workflow } from "lucide-react";
import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import type { RoboSatsPlatform } from "@/app/platform";
import { RoboSatsLogo } from "@/components/app/RoboSatsLogo";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { useGarageStore } from "@/domains/garage/garageStore";

const items = [
  { label: "Robot", to: "/garage", icon: Bot },
  { label: "Offers", to: "/offers", icon: Store },
  { label: "Create", to: "/create", icon: PlusCircle }
];

export function AppSidebar({ platform: _platform }: { platform: RoboSatsPlatform }) {
  const hydrate = useGarageStore((state) => state.hydrate);
  const slots = useGarageStore((state) => state.slots);
  const currentToken = useGarageStore((state) => state.currentToken);
  const activeSlot = slots.find((s) => s.token === currentToken) ?? slots[0];
  const activeTradePath = getActiveTradePath(activeSlot);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <aside className="app-sidebar">
      <div className="brand-block">
        <RoboSatsLogo />
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
            <item.icon size={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}
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
