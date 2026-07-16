export type TradeRole = "maker" | "taker";

export function roleBuysBitcoin(orderType: number, role: TradeRole): boolean {
  const makerBuysBitcoin = orderType === 0;
  return role === "maker" ? makerBuysBitcoin : !makerBuysBitcoin;
}

export function roleIntentLabel(orderType: number, isSwap: boolean, role: TradeRole): string {
  const buysBitcoin = roleBuysBitcoin(orderType, role);
  if (isSwap) return buysBitcoin ? "Swap In" : "Swap Out";
  return buysBitcoin ? "Buy BTC" : "Sell BTC";
}
