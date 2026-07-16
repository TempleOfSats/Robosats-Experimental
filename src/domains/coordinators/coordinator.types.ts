export type Origin = "onion" | "i2p" | "clearnet";
export type Network = "mainnet" | "testnet";
export type CoordinatorConnection = "api" | "nostr";
type CoordinatorNetworkUrls = Partial<Record<Origin, string | null>>;

export interface CoordinatorBadges {
  isFounder?: boolean;
  donatesToDevFund: number;
  hasGoodOpSec?: boolean;
  hasLargeLimits?: boolean;
}

export interface CoordinatorContact {
  nostr?: string | null;
  pgp?: string | null;
  fingerprint?: string | null;
  email?: string | null;
  telegram?: string | null;
  reddit?: string | null;
  matrix?: string | null;
  simplex?: string | null;
  twitter?: string | null;
  website?: string | null;
}

interface CoordinatorVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface CoordinatorDefinition {
  shortAlias: string;
  longAlias: string;
  identifier?: string;
  color: string;
  description?: string;
  motto?: string;
  established?: string;
  federated?: boolean;
  mainnet?: CoordinatorNetworkUrls;
  testnet?: CoordinatorNetworkUrls;
  mainnetNodesPubkeys?: string[];
  testnetNodesPubkeys?: string[];
  nostrHexPubkey?: string;
  contact?: CoordinatorContact;
  badges?: CoordinatorBadges;
  policies?: Record<string, string>;
}

export interface CoordinatorInfo {
  num_public_buy_orders: number;
  num_public_sell_orders: number;
  book_liquidity: number;
  active_robots_today: number;
  last_day_nonkyc_btc_premium: number;
  last_day_volume: number;
  lifetime_volume: number;
  maker_fee: number;
  taker_fee: number;
  bond_size: number;
  min_order_size: number;
  max_order_size: number;
  swap_enabled: boolean;
  max_swap: number;
  current_swap_fee_rate: number;
  lnd_version?: string | null;
  cln_version?: string | null;
  robosats_running_commit_hash?: string | null;
  alternative_site?: string | null;
  alternative_name?: string | null;
  node_alias?: string | null;
  node_id?: string | null;
  version?: CoordinatorVersion | null;
  network?: Network;
  market_price_apis?: string | null;
  notice_severity: "none" | "warning" | "error" | "success" | "info";
  notice_message: string;
}

interface CoordinatorLimit {
  code: string;
  price: number;
  min_amount: number;
  max_amount: number;
  max_bondless_amount?: number;
}

export type CoordinatorLimitList = Record<string, CoordinatorLimit>;

export interface CoordinatorSummary {
  shortAlias: string;
  longAlias: string;
  identifier?: string;
  color: string;
  url: string;
  federated?: boolean;
  mainnet?: CoordinatorNetworkUrls;
  testnet?: CoordinatorNetworkUrls;
  mainnetNodesPubkeys?: string[];
  testnetNodesPubkeys?: string[];
  nostrHexPubkey?: string;
  description?: string;
  motto?: string;
  established?: string;
  contact?: CoordinatorContact;
  badges?: CoordinatorBadges;
  policies?: Record<string, string>;
  avatarUrl: string;
  smallAvatarUrl: string;
  badgeIcons: CoordinatorBadgeIcon[];
  enabled: boolean;
  online: boolean;
  loading?: boolean;
  error?: string;
  info?: CoordinatorInfo;
  limits?: CoordinatorLimitList;
}

export interface CoordinatorBadgeIcon {
  key: keyof CoordinatorBadges;
  label: string;
  title: string;
  iconUrl: string;
  active: boolean;
  value?: string;
}
