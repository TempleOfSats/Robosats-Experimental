import type { ChatApiResponse } from "@/domains/chat/chat.types";
import type { CoordinatorInfo } from "@/domains/coordinators/coordinator.types";
import type { RobotApiResponse } from "@/domains/garage/robotApi";
import type { PublicOrderApi } from "@/domains/orderbook/orderbookModel";
import type { OrderApiResponse } from "@/domains/orders/orderModel";
import type { ClaimRewardApiResponse } from "@/domains/rewards/rewardApi";

export const coordinatorInfoFixture = {
  num_public_buy_orders: 12,
  num_public_sell_orders: 9,
  book_liquidity: 14436154,
  active_robots_today: 42,
  last_day_nonkyc_btc_premium: 1.25,
  last_day_volume: 0.37,
  lifetime_volume: 123.45,
  maker_fee: 0.00025,
  taker_fee: 0.00175,
  bond_size: 3,
  min_order_size: 20000,
  max_order_size: 5000000,
  swap_enabled: true,
  max_swap: 500000,
  current_swap_fee_rate: 2.8442,
  notice_severity: "none",
  notice_message: ""
} satisfies CoordinatorInfo;

export const coordinatorPublicOrderFixture = {
  id: "89895",
  created_at: "2026-07-03T06:54:02Z",
  expires_at: "2026-07-04T06:54:02Z",
  type: "1",
  currency: "20",
  amount: "1360.00000000",
  has_range: false,
  is_swap: false,
  min_amount: null,
  max_amount: null,
  payment_method: "Pix",
  premium: "0.00",
  satoshis: "419290",
  maker_nick: "WorthyRansom407",
  maker_hash_id: "maker-hash-id",
  bond_size_sats: "12642",
  bond_size: "3.00"
} satisfies PublicOrderApi;

export const coordinatorRobotFoundFixture = {
  nickname: "HelpfulVeranda735",
  hash_id: "robot-hash-id",
  public_key: "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n......\n......",
  encrypted_private_key: "-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n......\n......",
  wants_stealth: true,
  nostr_pubkey: "0afc27c9de67ea7bd5004cfac951b2c2acc326f9ab10d79bb57a51a74418a92c",
  active_order_id: null,
  last_order_id: 89895,
  earned_rewards: 6289,
  found: true,
  last_login: "2026-07-03T14:23:15Z",
  tg_enabled: false,
  tg_bot_name: "robosats_bot",
  tg_token: "telegram-token"
} satisfies RobotApiResponse;

export const coordinatorPrivateOrderFixture = {
  id: "89895",
  status: "9",
  type: "1",
  amount: "1360.00000000",
  currency: "20",
  payment_method: "Pix",
  premium: "0.00",
  satoshis: "419290",
  is_maker: false,
  is_taker: true,
  is_buyer: true,
  is_seller: false,
  maker_nick: "WorthyRansom407",
  maker_hash_id: "maker-hash-id",
  taker_nick: "HelpfulVeranda735",
  taker_hash_id: "taker-hash-id",
  bond_invoice: "lnbc125780n1pfixturebond",
  bond_satoshis: "12578",
  escrow_invoice: "lnbc4192900n1pfixtureescrow",
  escrow_satoshis: "419290",
  invoice_amount: "418137",
  swap_allowed: true,
  suggested_mining_fee_rate: "2.05",
  swap_fee_rate: "2.844200614692611",
  expires_at: "2026-07-03T14:23:15Z"
} satisfies OrderApiResponse;

export const coordinatorChatFixture = {
  peer_connected: true,
  peer_pubkey: "-----BEGIN PGP PUBLIC KEY BLOCK-----\\\\peer\\key",
  messages: [
    {
      index: "1",
      time: "2026-07-03T11:23:45Z",
      message: "-----BEGIN PGP MESSAGE-----\\\\ciphertext",
      nick: "HelpfulVeranda735"
    }
  ]
} satisfies ChatApiResponse;

export const coordinatorRewardSuccessFixture = {
  successful_withdrawal: true
} satisfies ClaimRewardApiResponse;

export const coordinatorRewardBadInvoiceFixture = {
  successful_withdrawal: false,
  bad_invoice: "Does not look like a valid lightning invoice"
} satisfies ClaimRewardApiResponse & { bad_invoice: string };
