import type { PropsWithChildren } from "react";
import type { RoboSatsPlatform } from "@/app/platform";
import { AppSidebar } from "@/components/app/AppSidebar";

export function AppShell({ children, platform }: PropsWithChildren<{ platform: RoboSatsPlatform }>) {
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <AppSidebar platform={platform} />
      <div className="app-main">
        <div id="main-content" className="app-content">
          {children}
        </div>
      </div>
    </div>
  );
}
