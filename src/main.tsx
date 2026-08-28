import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import "@fontsource-variable/public-sans/wght.css";
import "@/styles/globals.css";
import { applyUiPreferences } from "@/domains/settings/uiPreferences";
import { publishOrderChangeNotification } from "@/domains/orders/orderChangeNotifications";
import {
  isNativeApp,
  subscribeNativeOrderHints,
  webSocketImplementation
} from "@/domains/transport/androidBridge";
import { initializeDesktopRuntimeBridge } from "@/domains/transport/tauriBridge";
import { installRefreshIntentLifecycle } from "@/domains/transport/refreshIntents";
import { startOrderFeedbackRuntime } from "@/domains/notifications/orderFeedbackRuntime";
import { AppErrorBoundary } from "@/components/app/AppErrorBoundary";
import { startDisputeRewardRefreshRuntime } from "@/domains/rewards/disputeRewardRefresh";
import { installNativeTransportLifecycle } from "@/domains/transport/nativeTransportLifecycle";
import { installAssetLoadRecovery } from "@/app/assetLoadRecovery";

installAssetLoadRecovery(import.meta.url);
initializeDesktopRuntimeBridge();
installRefreshIntentLifecycle();
installNativeTransportLifecycle();
subscribeNativeOrderHints((hint) => {
  publishOrderChangeNotification({ source: "native", ...hint });
});
startOrderFeedbackRuntime();
startDisputeRewardRefreshRuntime();
window.dispatchEvent(new CustomEvent("robosats:boot-stage", {
  detail: { progress: 82, message: "Starting the private interface..." }
}));

applyUiPreferences();

function mountApp() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppErrorBoundary scope="app">
        <App />
      </AppErrorBoundary>
    </React.StrictMode>
  );
}

async function configureNativeWebSocket() {
  const { useWebSocketImplementation } = await import("nostr-tools/pool");
  useWebSocketImplementation(webSocketImplementation());
}

if (isNativeApp()) {
  void configureNativeWebSocket()
    .catch(() => undefined)
    .then(mountApp);
} else {
  mountApp();
}
