import { describe, expect, it } from "vitest";
import { normalizeChatResponse } from "@/domains/chat/chatApi";
import { normalizeRobotResponse } from "@/domains/garage/robotApi";
import { normalizePublicOrder } from "@/domains/orderbook/orderbookModel";
import { normalizeOrderDto } from "@/domains/orders/orderModel";
import { normalizeClaimRewardResponse } from "@/domains/rewards/rewardApi";
import {
  coordinatorChatFixture,
  coordinatorInfoFixture,
  coordinatorPrivateOrderFixture,
  coordinatorPublicOrderFixture,
  coordinatorRewardBadInvoiceFixture,
  coordinatorRewardSuccessFixture,
  coordinatorRobotFoundFixture
} from "@/test/fixtures/coordinatorApiFixtures";

describe("current RoboSats API fixtures", () => {
  it("matches the /api/info/ fixture to the coordinator info shape", () => {
    expect(coordinatorInfoFixture.book_liquidity).toBeGreaterThan(0);
    expect(coordinatorInfoFixture.notice_severity).toBe("none");
  });

  it("normalizes current /api/book/ orders", () => {
    expect(normalizePublicOrder(coordinatorPublicOrderFixture)).toMatchObject({
      id: 89895,
      type: 1,
      currency: 20,
      currencyCode: "BRL",
      expires_at: "2026-07-04T06:54:02Z",
      amount: 1360,
      payment_method: "Pix",
      satoshis: 419290,
      bond_size_sats: 12642,
      bond_size_percent: 3
    });
  });

  it("normalizes current /api/robot/ responses", () => {
    expect(normalizeRobotResponse(coordinatorRobotFoundFixture)).toMatchObject({
      nickname: "HelpfulVeranda735",
      earnedRewards: 6289,
      stealthInvoices: true,
      found: true,
      lastOrderId: 89895
    });
  });

  it("normalizes current private /api/order/ responses", () => {
    expect(normalizeOrderDto(coordinatorPrivateOrderFixture)).toMatchObject({
      id: 89895,
      status: 9,
      is_taker: true,
      is_buyer: true,
      invoice_amount: 418137,
      suggested_mining_fee_rate: 2.05
    });
  });

  it("normalizes current /api/chat/ responses", () => {
    expect(normalizeChatResponse(coordinatorChatFixture)).toMatchObject({
      peerConnected: true,
      peerPubkey: "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\npeer\nkey",
      messages: [
        {
          index: 1,
          encryptedMessage: "-----BEGIN PGP MESSAGE-----\n\nciphertext",
          nick: "HelpfulVeranda735"
        }
      ]
    });
  });

  it("normalizes current /api/reward/ responses", () => {
    expect(normalizeClaimRewardResponse(coordinatorRewardSuccessFixture)).toEqual({
      successfulWithdrawal: true
    });
    expect(normalizeClaimRewardResponse(coordinatorRewardBadInvoiceFixture)).toEqual({
      successfulWithdrawal: false,
      error: "Does not look like a valid lightning invoice"
    });
  });
});
