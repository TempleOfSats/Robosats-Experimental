export type OrderDirection = 0 | 1;

export interface CreateOrderPayload {
  type: OrderDirection;
  currency: number;
  amount: number | null;
  has_range: boolean;
  min_amount: number | null;
  max_amount: number | null;
  payment_method: string;
  is_explicit: boolean;
  premium: number | null;
  satoshis: number | null;
  public_duration: number;
  escrow_duration: number;
  bond_size: number;
  latitude: number;
  longitude: number;
  password: string | null;
  description: string | null;
}

export interface CreateOrderResponse {
  id?: number;
  shortAlias?: string;
  bad_request?: string;
  bad_password?: string;
  bad_payment_method?: string;
  bad_amount?: string;
  [key: string]: unknown;
}

export type CreateOrderDraft = {
  type: OrderDirection;
  currency: number;
  amount: string;
  hasRange: boolean;
  minAmount: string;
  maxAmount: string;
  paymentMethod: string;
  isSwap: boolean;
  isExplicit: boolean;
  premium: string;
  satoshis: string;
  publicDuration: string;
  escrowDuration: string;
  bondSize: string;
  latitude: string;
  longitude: string;
  password: string;
  description: string;
};
