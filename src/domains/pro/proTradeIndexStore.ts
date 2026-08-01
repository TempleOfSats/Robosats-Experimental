import { create } from "zustand";
import type { NostrOrderChangeNotification } from "@/domains/orders/orderChangeNotifications";
import type {
  ProSlotId,
  ProTradeKey,
  ProTradeLocator,
  ProTradeSnapshot,
  SlotSyncState
} from "@/domains/pro/pro.types";
import { proTradeKey } from "@/domains/pro/pro.types";
import { jitteredDelay, PRO_RECONCILE_POLICY } from "@/domains/pro/reconcilePolicy";

type ProTradeIndexState = {
  snapshots: Record<ProTradeKey, ProTradeSnapshot>;
  syncBySlot: Record<ProSlotId, SlotSyncState>;
  dirtyKeys: Partial<Record<ProTradeKey, true>>;
  hydrateRuntimeCache: (
    snapshots: Record<ProTradeKey, ProTradeSnapshot>,
    syncBySlot: Record<ProSlotId, SlotSyncState>
  ) => void;
  retainSlots: (slotIds: ReadonlySet<ProSlotId>) => void;
  markSlotLocallyReady: (slotId: ProSlotId, readyAt?: number) => void;
  upsertSnapshot: (snapshot: ProTradeSnapshot) => void;
  setSlotSync: (sync: SlotSyncState) => void;
  markDirtyByNostr: (slotId: ProSlotId, hint: NostrOrderChangeNotification) => void;
  clearDirty: (locator: ProTradeLocator) => void;
  removeTrade: (locator: ProTradeLocator) => void;
  removeCoordinatorSnapshots: (slotId: ProSlotId, shortAlias: string, exceptOrderIds?: number[]) => void;
  removeSlotSnapshots: (slotId: ProSlotId) => void;
  resetRuntimeCache: () => void;
};

export const useProTradeIndexStore = create<ProTradeIndexState>((set) => ({
  snapshots: {},
  syncBySlot: {},
  dirtyKeys: {},
  hydrateRuntimeCache: (snapshots, syncBySlot) => set({
    snapshots,
    syncBySlot,
    dirtyKeys: {}
  }),
  retainSlots: (slotIds) => set((state) => {
    const snapshots = Object.fromEntries(
      Object.entries(state.snapshots).filter(([, snapshot]) => slotIds.has(snapshot.locator.slotId))
    ) as Record<ProTradeKey, ProTradeSnapshot>;
    const syncBySlot = Object.fromEntries(
      Object.entries(state.syncBySlot).filter(([slotId]) => slotIds.has(slotId))
    );
    const dirtyKeys = Object.fromEntries(
      Object.entries(state.dirtyKeys).filter(([key]) => Boolean(snapshots[key as ProTradeKey]))
    ) as Partial<Record<ProTradeKey, true>>;
    return { snapshots, syncBySlot, dirtyKeys };
  }),
  markSlotLocallyReady: (slotId, readyAt = Date.now()) => set((state) => ({
    syncBySlot: {
      ...state.syncBySlot,
      [slotId]: {
        slotId,
        epoch: state.syncBySlot[slotId]?.epoch ?? 0,
        inFlight: false,
        locallyReadyAt: readyAt,
        nextEligibleAt: readyAt + jitteredDelay(
          PRO_RECONCILE_POLICY.idleMinMs,
          PRO_RECONCILE_POLICY.idleMaxMs
        )
      }
    }
  })),
  upsertSnapshot: (snapshot) => set((state) => ({
    snapshots: { ...state.snapshots, [snapshot.key]: snapshot }
  })),
  setSlotSync: (sync) => set((state) => ({
    syncBySlot: { ...state.syncBySlot, [sync.slotId]: sync }
  })),
  markDirtyByNostr: (slotId, hint) => set((state) => {
    if (!hint.shortAlias || !hint.orderId) return state;
    const key = proTradeKey({ slotId, shortAlias: hint.shortAlias, orderId: hint.orderId });
    return { dirtyKeys: { ...state.dirtyKeys, [key]: true } };
  }),
  clearDirty: (locator) => set((state) => {
    const key = proTradeKey(locator);
    const dirtyKeys = { ...state.dirtyKeys };
    delete dirtyKeys[key];
    return { dirtyKeys };
  }),
  removeTrade: (locator) => set((state) => {
    const key = proTradeKey(locator);
    const snapshots = { ...state.snapshots };
    const dirtyKeys = { ...state.dirtyKeys };
    delete snapshots[key];
    delete dirtyKeys[key];
    return { snapshots, dirtyKeys };
  }),
  removeCoordinatorSnapshots: (slotId, shortAlias, exceptOrderIds = []) => set((state) => {
    const keep = new Set(exceptOrderIds);
    const snapshots = { ...state.snapshots };
    const dirtyKeys = { ...state.dirtyKeys };
    for (const [key, snapshot] of Object.entries(snapshots) as Array<[ProTradeKey, ProTradeSnapshot]>) {
      if (snapshot.locator.slotId !== slotId || snapshot.locator.shortAlias !== shortAlias) continue;
      if (keep.has(snapshot.locator.orderId)) continue;
      delete snapshots[key];
      delete dirtyKeys[key];
    }
    return { snapshots, dirtyKeys };
  }),
  removeSlotSnapshots: (slotId) => set((state) => {
    const snapshots = { ...state.snapshots };
    const dirtyKeys = { ...state.dirtyKeys };
    for (const [key, snapshot] of Object.entries(snapshots) as Array<[ProTradeKey, ProTradeSnapshot]>) {
      if (snapshot.locator.slotId !== slotId) continue;
      delete snapshots[key];
      delete dirtyKeys[key];
    }
    const syncBySlot = { ...state.syncBySlot };
    delete syncBySlot[slotId];
    return { snapshots, dirtyKeys, syncBySlot };
  }),
  resetRuntimeCache: () => set({ snapshots: {}, syncBySlot: {}, dirtyKeys: {} })
}));
