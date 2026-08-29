import { useEffect, useState } from "react";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";

type GuidedOrderbookState = {
  orders: PublicOrder[];
  loading: boolean;
  refreshing: boolean;
  error?: string;
};

export type GuidedOrderbookSnapshot = GuidedOrderbookState & { retry: () => void };

export function useGuidedOrderbook(open: boolean): GuidedOrderbookSnapshot {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<GuidedOrderbookState>({
    orders: [],
    loading: true,
    refreshing: false
  });

  useEffect(() => {
    if (!open) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setSnapshot((current) => ({ ...current, loading: true, error: undefined }));
    void import("@/domains/orderbook/orderbookStore")
      .then(async ({ useOrderbookStore }) => {
        if (!active) return;
        const updateOrderbook = () => {
          const state = useOrderbookStore.getState();
          setSnapshot({ orders: state.orders, loading: state.loading, refreshing: state.refreshing });
        };
        updateOrderbook();
        unsubscribe = useOrderbookStore.subscribe(updateOrderbook);
        await refreshGuidedOrderbook(useOrderbookStore);
      })
      .catch(() => {
        if (!active) return;
        setSnapshot((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          error: "Offers could not be loaded. Check your connection and try again."
        }));
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [attempt, open]);

  return { ...snapshot, retry: () => setAttempt((current) => current + 1) };
}

async function refreshGuidedOrderbook(
  orderbookStore: typeof import("@/domains/orderbook/orderbookStore").useOrderbookStore
): Promise<void> {
  let federation = useFederationStore.getState();
  if (federation.connection !== "nostr") {
    await federation.refreshCoordinators();
    federation = useFederationStore.getState();
  }
  await orderbookStore.getState().refreshOrderbook(federation.coordinators, {
    connection: federation.connection,
    hostUrl: typeof window === "undefined" ? "" : window.location.host,
    network: federation.network,
    origin: federation.origin
  });
}
