import type { PropsWithChildren } from "react";
import type { RoboSatsPlatform } from "@/app/platform";
import { AppSidebar } from "@/components/app/AppSidebar";
import { DesktopTitleBar } from "@/components/app/DesktopTitleBar";

export function AppShell({ children, platform }: PropsWithChildren<{ platform: RoboSatsPlatform }>) {
  return (
    <div className={platform.client === "desktop" ? "app-runtime app-runtime-desktop" : "app-runtime"}>
      {platform.client === "desktop" ? <DesktopTitleBar /> : null}
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
    </div>
  );
}
