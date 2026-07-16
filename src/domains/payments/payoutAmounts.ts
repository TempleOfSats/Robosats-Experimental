const ONCHAIN_TX_VBYTES = 280;
const MIN_MINING_FEE_RATE = 2;

export function lightningPayoutAmount(tradeSats: number, routingBudgetPpm: number): number {
  const sats = positiveFinite(tradeSats);
  const ppm = Math.min(100_001, Math.max(0, finiteOrZero(routingBudgetPpm)));
  return Math.max(0, Math.floor(sats - sats * (ppm / 1_000_000)));
}

export function lightningRoutingBudgetSats(tradeSats: number, routingBudgetPpm: number): number {
  return Math.max(0, positiveFinite(tradeSats) - lightningPayoutAmount(tradeSats, routingBudgetPpm));
}

export function onchainPayoutBreakdown(invoiceAmount: number, swapFeeRate: number, miningFeeRate: number) {
  const grossSats = positiveFinite(invoiceAmount);
  const effectiveMiningFeeRate = Math.min(500, Math.max(MIN_MINING_FEE_RATE, finiteOrZero(miningFeeRate)));
  const swapFeeSats = Math.floor(grossSats * (Math.max(0, finiteOrZero(swapFeeRate)) / 100));
  const miningFeeSats = Math.floor(effectiveMiningFeeRate * ONCHAIN_TX_VBYTES);
  return {
    effectiveMiningFeeRate,
    finalSats: Math.max(0, Math.floor(grossSats - swapFeeSats - miningFeeSats)),
    miningFeeSats,
    swapFeeSats
  };
}

function positiveFinite(value: number): number {
  return Math.max(0, finiteOrZero(value));
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
