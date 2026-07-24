import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  DESKTOP_NOTIFICATION_OPEN_EVENT,
  takePendingDesktopNotificationRoute
} from "@/domains/transport/tauriBridge";

export function DesktopNotificationRouter() {
  const navigate = useNavigate();

  useEffect(() => {
    const openRoute = (route: unknown) => {
      if (typeof route === "string" && /^\/order\/[a-z0-9-]+\/[1-9]\d*$/i.test(route)) {
        navigate(route);
      }
    };
    const onNotificationOpen = (event: Event) => {
      openRoute((event as CustomEvent<unknown>).detail);
    };

    openRoute(takePendingDesktopNotificationRoute());
    window.addEventListener(DESKTOP_NOTIFICATION_OPEN_EVENT, onNotificationOpen);
    return () => window.removeEventListener(DESKTOP_NOTIFICATION_OPEN_EVENT, onNotificationOpen);
  }, [navigate]);

  return null;
}
