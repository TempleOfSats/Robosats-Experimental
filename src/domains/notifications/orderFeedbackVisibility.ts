import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";

const visibleTrades = new Map<string, number>();

export function registerVisibleTrade(shortAlias: string, orderId: number): () => void {
  const key = tradeKey(shortAlias, orderId);
  visibleTrades.set(key, (visibleTrades.get(key) ?? 0) + 1);
  return () => {
    const remaining = (visibleTrades.get(key) ?? 1) - 1;
    if (remaining > 0) visibleTrades.set(key, remaining);
    else visibleTrades.delete(key);
  };
}

export function shouldPlayOrderFeedbackAudio(shortAlias: string, orderId: number): boolean {
  if (!useProPreferencesStore.getState().enabled) return true;
  return visibleTrades.has(tradeKey(shortAlias, orderId));
}

export function resetOrderFeedbackVisibilityForTests(): void {
  visibleTrades.clear();
}

function tradeKey(shortAlias: string, orderId: number): string {
  return `${shortAlias}:${orderId}`;
}
