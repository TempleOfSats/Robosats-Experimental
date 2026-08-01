import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ColdOrderLoadState } from "@/domains/orders/OrderPage";

describe("cold order loading", () => {
  it("offers a neutral retry state after a transient failure", () => {
    const html = renderToStaticMarkup(
      <ColdOrderLoadState
        failure={{ kind: "transient", message: "The trade is taking longer to open." }}
        orderId={91880}
        phase="idle"
        reconnectingTor={false}
        torReconnectAvailable={false}
        torReconnectFailed={false}
        onReconnectTor={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(html).toContain("Trade not loaded yet");
    expect(html).toContain("Retry");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("status-panel-warning");
    expect(html).not.toContain("Could not reach");
    expect(html).not.toContain("did not respond");
    expect(html).not.toContain("coordinator");
    expect(html).not.toContain("Reconnect Tor");
  });

  it("shows Tor recovery only when the runtime exposes it", () => {
    const html = renderToStaticMarkup(
      <ColdOrderLoadState
        failure={{ kind: "transient", message: "The trade is taking longer to open." }}
        orderId={91880}
        phase="idle"
        reconnectingTor
        torReconnectAvailable
        torReconnectFailed={false}
        onReconnectTor={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(html).toContain("Reconnecting Tor");
    expect(html).toContain("Reconnect Tor");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
    expect(html.match(/<button[^>]*>.*?Retry<\/button>/)?.[0]).not.toContain("disabled");
  });

  it("keeps specific non-transient guidance distinct", () => {
    const html = renderToStaticMarkup(
      <ColdOrderLoadState
        failure={{ kind: "authentication", message: "Load a robot to fetch this private order." }}
        orderId={91880}
        phase="idle"
        reconnectingTor={false}
        torReconnectAvailable
        torReconnectFailed={false}
        onReconnectTor={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(html).toContain("Robot required");
    expect(html).toContain("Load a robot to fetch this private order.");
    expect(html).toContain("status-panel-warning");
    expect(html).toContain("Retry");
    expect(html).not.toContain("Reconnect Tor");
  });

  it("keeps an unconfirmed Tor reconnect actionable and neutral", () => {
    const html = renderToStaticMarkup(
      <ColdOrderLoadState
        failure={{ kind: "transient", message: "The trade is taking longer to open." }}
        orderId={91880}
        phase="idle"
        reconnectingTor={false}
        torReconnectAvailable
        torReconnectFailed
        onReconnectTor={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(html).toContain("Tor reconnect was not confirmed.");
    expect(html).toContain("Retry");
    expect(html).toContain("Reconnect Tor");
    expect(html).not.toContain("coordinator");
  });
});
