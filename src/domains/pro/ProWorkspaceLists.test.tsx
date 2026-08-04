// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { HistoryList, TradeList } from "@/domains/pro/ProWorkspaceLists";
import type { TradeHistoryEntry } from "@/domains/pro/tradeHistory";

let root: Root | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("Pro workspace lists", () => {
  it("renders robot rewards as claim work without an empty-trades message", () => {
    const html = renderToStaticMarkup(
      <TradeList
        coordinators={[]}
        onCancel={vi.fn()}
        onClaimRewards={vi.fn()}
        onCreate={vi.fn()}
        onFindTrade={vi.fn()}
        onOpen={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        quickActionKey=""
        rewardSlots={[rewardSlot]}
        snapshots={[]}
      />
    );

    expect(html).toContain("Rewards ready");
    expect(html).toContain("2,100 sats");
    expect(html).toContain("Claim");
    expect(html).not.toContain("No matching trades");
  });

  it("describes a seller's fee-inclusive history amount as bitcoin sent", async () => {
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(<HistoryList coordinators={[]} entries={[sellerHistoryEntry]} />);
    });

    const row = document.querySelector<HTMLButtonElement>('[aria-label="Open finished order 92045 for Seller"]');
    if (!row) throw new Error("Missing seller history row");
    await act(async () => row.click());

    const title = document.querySelector<HTMLElement>("#pro-history-detail-title");
    expect(title?.hasAttribute("data-dialog-initial-focus")).toBe(true);
    expect(document.activeElement).toBe(title);
    expect(document.body.textContent).toContain("Bitcoin sent18,991 sats");
    expect(document.body.textContent).toContain("Escrow paid through this invoice");
    expect(document.body.textContent).not.toContain("Bitcoin sold18,991 sats");
  });

  it.each([
    ["dispute-won", "Dispute won"],
    ["dispute-lost", "Dispute lost"]
  ] as const)("shows a %s result in history", (outcome, label) => {
    const html = renderToStaticMarkup(<HistoryList coordinators={[]} entries={[{ ...sellerHistoryEntry, outcome }]} />);

    expect(html).toContain(label);
  });

  it("labels the bitcoin amount neutrally for a disputed trade", async () => {
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(<HistoryList coordinators={[]} entries={[{ ...sellerHistoryEntry, outcome: "dispute-lost" }]} />);
    });

    const row = document.querySelector<HTMLButtonElement>('[aria-label="Open finished order 92045 for Seller"]');
    if (!row) throw new Error("Missing disputed history row");
    await act(async () => row.click());

    expect(document.body.textContent).toContain("Contract bitcoin18,991 sats");
    expect(document.body.textContent).not.toContain("Bitcoin sent18,991 sats");
  });
});

const rewardSlot = {
  token: "reward-token-with-enough-entropy",
  hashId: "reward-hash",
  tokenSHA256: "reward-slot",
  nostrPubKey: "nostr-public",
  nostrSecKey: new Uint8Array(32),
  entropyBits: 216,
  hasEnoughEntropy: true,
  shannonEntropy: 5,
  nickname: "Reward Robot",
  earnedRewards: 2_100,
  robots: {}
} satisfies RobotSlot;

const sellerHistoryEntry = {
  id: "slot:temple:92045",
  slotId: "slot",
  robotName: "Seller",
  robotHashId: "seller-hash",
  coordinatorShortAlias: "temple",
  orderId: 92045,
  role: "seller",
  origin: "taker",
  amount: 12,
  currency: 1,
  paymentMethod: "Revolut",
  premium: 0,
  satoshis: 18_991,
  settlementInvoice: "lnbc18991n1fixture",
  settlementInvoicePurpose: "escrow-paid",
  outcome: "completed",
  completedAt: Date.UTC(2026, 7, 2, 19, 25),
  revision: 1,
  deviceId: "device",
  updatedAt: Date.UTC(2026, 7, 2, 19, 25)
} satisfies TradeHistoryEntry;
