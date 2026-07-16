import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import "@fontsource-variable/public-sans/wght.css";
import "@/styles/globals.css";
import { applyUiPreferences } from "@/domains/settings/uiPreferences";
import { useWebSocketImplementation } from "nostr-tools/pool";
import { webSocketImplementation } from "@/domains/transport/androidBridge";

window.dispatchEvent(new CustomEvent("robosats:boot-stage", {
  detail: { progress: 82, message: "Starting the private interface..." }
}));

applyUiPreferences();
useWebSocketImplementation(webSocketImplementation());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
