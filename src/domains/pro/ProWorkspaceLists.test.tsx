// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { HistoryList, RobotList, TradeList } from "@/domains/pro/ProWorkspaceLists";
import type { ProTradeSnapshot } from "@/domains/pro/pro.types";
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
  it("shows an active robot trade identity beside its status", () => {
    const html = renderToStaticMarkup(
      <RobotList
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onDownload={vi.fn()}
        onOpenTrade={vi.fn()}
        onSettings={vi.fn()}
        onTelegram={vi.fn()}
        slots={[rewardSlot]}
        snapshots={{
          active: {
            key: "reward-slot:temple:92195",
            locator: { slotId: "reward-slot", shortAlias: "temple", orderId: 92195 },
            nickname: "Reward Robot",
            hashId: "reward-hash",
            order: {
              amount: 12,
              currency: 2,
              payment_method: "Revolut",
              status: 9,
              is_buyer: true,
              is_seller: false
            } as never,
            renewable: false,
            released: false,
            freshness: "fresh"
          }
        }}
        summaries={[
          {
            slotId: "reward-slot",
            nickname: "Reward Robot",
            hashId: "reward-hash",
            coordinatorCount: 1,
            activeTradeCount: 1,
            publicOfferCount: 0,
            needsAttentionCount: 1,
            relevantOrderCount: 1,
            stale: false
          }
        ]}
        syncBySlot={{ "reward-slot": { slotId: "reward-slot", epoch: 1, inFlight: false, lastSuccessAt: 1 } }}
      />
    );

    expect(html).toContain("€12 · Revolut · #92195");
  });

  it("leaves the trade identity out when order data is unavailable", () => {
    const html = renderToStaticMarkup(
      <RobotList
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onDownload={vi.fn()}
        onOpenTrade={vi.fn()}
        onSettings={vi.fn()}
        onTelegram={vi.fn()}
        slots={[rewardSlot]}
        snapshots={{
          pending: {
            key: "reward-slot:temple:92195",
            locator: { slotId: "reward-slot", shortAlias: "temple", orderId: 92195 },
            nickname: "Reward Robot",
            hashId: "reward-hash",
            renewable: false,
            released: false,
            freshness: "refreshing"
          }
        }}
        summaries={[
          {
            slotId: "reward-slot",
            nickname: "Reward Robot",
            hashId: "reward-hash",
            coordinatorCount: 1,
            activeTradeCount: 1,
            publicOfferCount: 0,
            needsAttentionCount: 0,
            relevantOrderCount: 1,
            stale: false
          }
        ]}
        syncBySlot={{ "reward-slot": { slotId: "reward-slot", epoch: 1, inFlight: true } }}
      />
    );

    expect(html).not.toContain("#92195");
  });

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

  it("keeps public-offer actions compact and represents the coordinator by avatar", () => {
    const html = renderToStaticMarkup(
      <TradeList
        coordinators={[
          {
            shortAlias: "temple",
            longAlias: "Temple of Sats",
            smallAvatarUrl: "/temple.webp"
          } as never
        ]}
        onCancel={vi.fn()}
        onClaimRewards={vi.fn()}
        onCreate={vi.fn()}
        onFindTrade={vi.fn()}
        onOpen={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        quickActionKey=""
        rewardSlots={[]}
        snapshots={[publicOfferSnapshot]}
      />
    );

    expect(html).toContain('aria-label="Pause order 92452"');
    expect(html).toContain('aria-label="Cancel order 92452"');
    expect(html).toContain('title="Temple of Sats"');
    expect(html).toContain('src="/temple.webp"');
    expect(html).not.toContain("pro-trade-action-label");
    expect(html).not.toContain("<span>Temple of Sats</span>");
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
    expect(document.body.textContent).toContain("You sold bitcoin18,991 sats");
    expect(document.body.textContent).toContain("Contract bitcoin18,991 sats");
    expect(document.body.textContent).toContain("Escrow paid through this invoice");
    expect(document.body.textContent).toContain("Download overview");
    expect(document.body.textContent).not.toContain("Bitcoin sold18,991 sats");
  });

  it.each([
    ["dispute-won", "Dispute won"],
    ["dispute-lost", "Dispute lost"]
  ] as const)("shows a %s result in history", (outcome, label) => {
    const html = renderToStaticMarkup(<HistoryList coordinators={[]} entries={[{ ...sellerHistoryEntry, outcome }]} />);

    expect(html).toContain(label);
  });

  it("shows a resolved dispute with the contract bitcoin amount and Fleet-history location", async () => {
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(<HistoryList coordinators={[]} entries={[{ ...sellerHistoryEntry, outcome: "dispute-lost" }]} />);
    });

    const row = document.querySelector<HTMLButtonElement>('[aria-label="Open finished order 92045 for Seller"]');
    if (!row) throw new Error("Missing disputed history row");
    await act(async () => row.click());

    expect(document.body.textContent).toContain("Contract bitcoin18,991 sats");
    expect(document.body.textContent).not.toContain("Bitcoin sent18,991 sats");
    expect(document.body.textContent).toContain("Dispute resolved");
    expect(document.body.textContent).toContain(
      "This summary is kept in your encrypted Fleet history stored over nostr."
    );
  });

  it("does not present an unrecoverable legacy bitcoin amount as zero", async () => {
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(<HistoryList coordinators={[]} entries={[{ ...sellerHistoryEntry, satoshis: 0 }]} />);
    });

    const row = document.querySelector<HTMLButtonElement>('[aria-label="Open finished order 92045 for Seller"]');
    if (!row) throw new Error("Missing zero-amount history row");
    await act(async () => row.click());

    expect(document.body.textContent).toContain("You sold bitcoinNot recorded");
    expect(document.body.textContent).toContain("Contract bitcoinNot recorded");
    expect(document.body.textContent).not.toContain("Contract bitcoin0 sats");
  });

  it("presents a BTC-denominated history entry as a bitcoin swap", async () => {
    root = createRoot(document.querySelector("#root")!);
    await act(async () => {
      root?.render(
        <HistoryList
          coordinators={[]}
          entries={[{ ...sellerHistoryEntry, amount: 0.001, currency: 1000, role: "buyer" }]}
        />
      );
    });

    const row = document.querySelector<HTMLButtonElement>('[aria-label="Open finished order 92045 for Seller"]');
    if (!row) throw new Error("Missing swap history row");
    expect(row.textContent).toContain("Bitcoin swap");
    expect(row.textContent).toContain("100,000 sats");
    await act(async () => row.click());

    expect(document.body.textContent).toContain("Bitcoin swap completed");
    expect(document.body.textContent).toContain("Bitcoin received18,991 sats");
    expect(document.body.textContent).toContain("Contract amount100,000 sats");
    expect(document.body.textContent).not.toContain("Contract fiat");
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

const publicOfferSnapshot = {
  key: "slot:temple:92452",
  locator: { slotId: "slot", shortAlias: "temple", orderId: 92452 },
  nickname: "LaughingPottery870",
  hashId: "robot-hash",
  order: {
    status: 1,
    type: 1,
    currency: 2,
    amount: 1_000,
    has_range: true,
    min_amount: 1_000,
    max_amount: 2_500,
    payment_method: "Instant SEPA",
    expires_at: "2099-01-01T00:00:00.000Z",
    is_maker: true,
    is_taker: false,
    is_buyer: false,
    is_seller: true
  } as never,
  renewable: false,
  released: false,
  freshness: "fresh"
} satisfies ProTradeSnapshot;

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
