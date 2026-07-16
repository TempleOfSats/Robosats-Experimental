export interface PublicOrder {
  id: number;
  created_at?: string;
  expires_at?: string;
  type: number;
  currency: number;
  currencyCode?: string;
  amount: number | null;
  has_range: boolean;
  has_password?: boolean;
  is_swap: boolean;
  min_amount: number;
  max_amount: number;
  payment_method: string;
  description?: string;
  premium: number;
  satoshis: number;
  satoshis_now?: number;
  maker_nick: string;
  maker_hash_id: string;
  bond_size_sats: number;
  bond_size_percent?: number;
  coordinatorShortAlias: string;
}
