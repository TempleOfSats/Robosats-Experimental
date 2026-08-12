// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { RewardWithdrawalPanel } from "@/domains/rewards/RewardWithdrawalPanel";

const mocks = vi.hoisted(() => ({
  claimReward: vi.fn(),
  playHaptic: vi.fn(),
  playTradeAudio: vi.fn(() => Promise.resolve()),
  signCleartextMessage: vi.fn(() => Promise.resolve("signed-invoice"))
}));

vi.mock("@/domains/audio/audioController", () => ({ playTradeAudio: mocks.playTradeAudio }));
vi.mock("@/domains/crypto/pgp", () => ({ signCleartextMessage: mocks.signCleartextMessage }));
vi.mock("@/domains/rewards/rewardApi", () => ({ claimReward: mocks.claimReward }));
vi.mock("@/lib/haptics", () => ({ playHaptic: mocks.playHaptic }));

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  Object.values(mocks).forEach((mock) => mock.mockClear());
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("reward withdrawal audio", () => {
  it("plays the reward sound only after a definitive successful withdrawal", async () => {
    mocks.claimReward.mockResolvedValueOnce({ successfulWithdrawal: true });
    const onClaimed = vi.fn();
    await renderPanel(onClaimed);

    await submitInvoice();

    expect(mocks.playTradeAudio).toHaveBeenCalledExactlyOnceWith("rewards-withdrawal-success");
    expect(onClaimed).toHaveBeenCalledExactlyOnceWith("temple");
  });

  it("keeps rejected withdrawals silent", async () => {
    mocks.claimReward.mockResolvedValueOnce({ successfulWithdrawal: false, error: "rejected" });
    await renderPanel(vi.fn());

    await submitInvoice();

    expect(mocks.playTradeAudio).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("rejected");
  });
});

async function renderPanel(onClaimed: (shortAlias: string) => void): Promise<void> {
  await act(async () => {
    root?.render(<RewardWithdrawalPanel coordinators={[coordinator]} onClaimed={onClaimed} slot={slot} />);
  });
}

async function submitInvoice(): Promise<void> {
  const invoice = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="lnbc..."]');
  if (!invoice) throw new Error("Missing invoice input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(invoice, "lnbc-fixture");
    invoice.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Withdraw your sats")
  );
  if (!submit) throw new Error("Missing withdrawal button");
  await act(async () => {
    submit.click();
    await Promise.resolve();
  });
}

const coordinator = {
  shortAlias: "temple",
  longAlias: "Temple",
  url: "https://coordinator.example"
} as CoordinatorSummary;

const slot = {
  token: "fixture-token",
  tokenSHA256: "fixture-token-hash",
  earnedRewards: 2_100,
  robots: {
    temple: {
      shortAlias: "temple",
      tokenSHA256: "fixture-token-hash",
      encPrivKey: "encrypted-private-key",
      earnedRewards: 2_100
    }
  }
} as unknown as RobotSlot;
