// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetVaultDialogs } from "@/domains/pro/FleetVaultDialogs";
import { OfferPresetsDialog } from "@/domains/pro/OfferPresetsDialog";
import type { OfferPreset } from "@/domains/pro/portableSettings";
import { CreateOfferRobotPicker, ProActionNotice } from "@/domains/pro/ProWorkspaceDialogs";
import type { OfferReadyRobots } from "@/domains/pro/proRobotLifecycle";
import { shouldAutoSelectReadyRobot } from "@/domains/pro/ProTakeRobotPicker";

vi.mock("@/domains/identity/RobotAvatar", () => ({
  RobotAvatar: ({ label }: { label?: string }) => <span data-testid="robot-avatar">{label}</span>
}));

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("CreateOfferRobotPicker", () => {
  it("recommends a fresh robot without repeating warnings when every available identity was used", async () => {
    const onAddRobot = vi.fn().mockResolvedValue("fresh-slot");
    const onSelect = vi.fn();
    await renderPicker([robot("used-slot", "Used Robot", true)], { onAddRobot, onSelect });

    expect(document.body.textContent).toContain("Fresh robot");
    expect(document.body.textContent).toContain("New identity · Best privacy");
    expect(document.body.textContent).toContain("Or reuse an available robot");
    expect(document.body.textContent).toContain("Used before");
    expect(document.body.textContent).not.toContain("previously used identity");

    await clickButton("Used Robot");
    expect(document.body.textContent).toContain("A fresh robot provides better separation between trades.");

    await clickButton("Create fresh robot");
    expect(onAddRobot).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("fresh-slot");
  });

  it("requires one confirmation before reusing a robot", async () => {
    const onSelect = vi.fn();
    await renderPicker([robot("used-slot", "Used Robot", true)], { onSelect });

    await clickButton("Used Robot");
    expect(onSelect).not.toHaveBeenCalled();

    await clickButton("Use this robot");
    expect(onSelect).toHaveBeenCalledWith("used-slot");
  });

  it("uses an unused ready robot directly and does not suggest creating another", async () => {
    const onAddRobot = vi.fn().mockResolvedValue("another-slot");
    const onSelect = vi.fn();
    await renderPicker([robot("fresh-slot", "Fresh Robot", false), robot("used-slot", "Used Robot", true)], {
      onAddRobot,
      onSelect
    });

    expect(buttonWithText("Fresh robot")).toBeUndefined();
    await clickButton("Fresh Robot");
    expect(onSelect).toHaveBeenCalledWith("fresh-slot");
    expect(onAddRobot).not.toHaveBeenCalled();
  });
});

describe("FleetVaultDialogs", () => {
  it("explains preservation and offers a safe restore path", async () => {
    const onRestore = vi.fn();
    const onUseStandardGarage = vi.fn();
    await act(async () => {
      root?.render(
        <FleetVaultDialogs
          error="The encrypted Fleet could not be opened."
          onCloseRecovery={vi.fn()}
          onComplete={vi.fn()}
          onRestore={onRestore}
          onUseStandardGarage={onUseStandardGarage}
          recoveryOpen={false}
          setupOpen={false}
          status="error"
        />
      );
    });

    expect(document.body.textContent).toContain("Saved Fleet needs attention");
    expect(document.body.textContent).toContain("The encrypted Fleet could not be opened");
    expect(document.body.textContent).toContain("Nothing was erased");

    await clickButton("Restore Fleet");
    expect(onRestore).toHaveBeenCalledOnce();
    await clickButton("Use standard Garage");
    expect(onUseStandardGarage).toHaveBeenCalledOnce();
  });
});

describe("take-offer robot selection", () => {
  it("auto-selects one unused robot but asks before reusing one", () => {
    expect(shouldAutoSelectReadyRobot([robot("fresh-slot", "Fresh Robot", false)])).toBe(true);
    expect(shouldAutoSelectReadyRobot([robot("used-slot", "Used Robot", true)])).toBe(false);
  });
});

describe("ProActionNotice", () => {
  it("announces contextual confirmation and dismisses automatically", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await act(async () => {
      root?.render(
        <ProActionNotice detail="#92452 · LaughingPottery870" noticeKey={1} onClose={onClose} title="Offer paused" />
      );
    });

    const notice = document.querySelector<HTMLElement>('[role="status"]');
    expect(notice?.getAttribute("aria-live")).toBe("polite");
    expect(notice?.getAttribute("aria-atomic")).toBe("true");
    expect(notice?.textContent).toContain("Offer paused");
    expect(notice?.textContent).toContain("#92452 · LaughingPottery870");

    await act(async () => vi.advanceTimersByTime(3_599));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("OfferPresetsDialog", () => {
  it("keeps Use visible and routes secondary preset actions through one overflow", async () => {
    const onDuplicate = vi.fn();
    await act(async () => {
      root?.render(
        <OfferPresetsDialog
          onClose={vi.fn()}
          onCreate={vi.fn()}
          onDuplicate={onDuplicate}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onUse={vi.fn()}
          presets={[offerPreset]}
        />
      );
    });

    expect(buttonWithText("Use")).toBeDefined();
    const summary = document.querySelector<HTMLElement>('summary[aria-label="More actions for Weekday buy"]');
    expect(summary).toBeDefined();
    expect(summary?.getAttribute("tabindex")).toBe("0");
    const duplicate = buttonWithText("Duplicate");
    if (!duplicate) throw new Error("Missing duplicate preset action");
    duplicate.closest("details")?.setAttribute("open", "");
    await act(async () => duplicate.click());
    expect(onDuplicate).toHaveBeenCalledWith(offerPreset);
    expect(duplicate.closest("details")?.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it("moves focus into preset removal confirmation", async () => {
    await act(async () => {
      root?.render(
        <OfferPresetsDialog
          onClose={vi.fn()}
          onCreate={vi.fn()}
          onDuplicate={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onUse={vi.fn()}
          presets={[offerPreset]}
        />
      );
    });

    const remove = buttonWithText("Remove");
    if (!remove) throw new Error("Missing remove preset action");
    remove.closest("details")?.setAttribute("open", "");
    await act(async () => remove.click());

    const keep = buttonWithText("Keep");
    expect(document.body.textContent).toContain("Remove this preset?");
    expect(document.activeElement).toBe(keep);
  });
});

async function renderPicker(
  robots: OfferReadyRobots,
  options: {
    onAddRobot?: () => Promise<string | undefined>;
    onSelect: (slotId: string) => void;
  }
) {
  await act(async () => {
    root?.render(
      <CreateOfferRobotPicker
        onAddRobot={options.onAddRobot}
        onClose={vi.fn()}
        onSelect={options.onSelect}
        robots={robots}
      />
    );
  });
}

async function clickButton(text: string) {
  const button = buttonWithText(text);
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.includes(text)
  );
}

function robot(slotId: string, nickname: string, previouslyUsed: boolean): OfferReadyRobots[number] {
  return {
    slotId,
    nickname,
    hashId: `${slotId}-hash`,
    coordinatorCount: 1,
    activeTradeCount: 0,
    publicOfferCount: 0,
    needsAttentionCount: 0,
    relevantOrderCount: 0,
    stale: false,
    previouslyUsed
  };
}

const offerPreset = {
  id: "00112233445566778899aabbccddeeff",
  name: "Weekday buy",
  direction: 0,
  isSwap: false,
  currency: "EUR",
  amount: "500",
  paymentMethods: ["Instant SEPA"],
  premium: 0,
  bond: 3,
  publicDuration: 24,
  escrowDuration: 24,
  description: "",
  password: "",
  revision: 1,
  deviceId: "ffeeddccbbaa99887766554433221100",
  deleted: false,
  updatedAt: 1
} satisfies OfferPreset;
