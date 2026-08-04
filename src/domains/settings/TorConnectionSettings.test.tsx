import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TorConnectionDialog } from "@/domains/settings/TorConnectionSettings";

describe("Tor connection settings", () => {
  it("places the explicit reset action beside reconnect when supported", () => {
    const html = renderToStaticMarkup(
      <TorConnectionDialog
        canReconnect
        canReset
        diagnostics={null}
        reconnect={vi.fn()}
        reconnectState="idle"
        refresh={vi.fn()}
        reset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain("Reconnect Tor");
    expect(html).toContain(">Reset</button>");
    expect(html.indexOf("Reconnect Tor")).toBeLessThan(html.indexOf(">Reset</button>"));
  });

  it("does not offer reset on native bridges without destructive reset support", () => {
    const html = renderToStaticMarkup(
      <TorConnectionDialog
        canReconnect
        canReset={false}
        diagnostics={null}
        reconnect={vi.fn()}
        reconnectState="idle"
        refresh={vi.fn()}
        reset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain("Reconnect Tor");
    expect(html).not.toContain(">Reset</button>");
  });
});
