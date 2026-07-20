import { create } from "zustand";
import type {
  OrderHint,
  ProSlotId,
  ProTradeKey,
  ProTradeLocator,
  ProTradeSnapshot,
  SlotSyncState
} from "@/domains/pro/pro.types";
import { proTradeKey } from "@/domains/pro/pro.types";

type ProTradeIndexState = {
  snapshots: Record<ProTradeKey, ProTradeSnapshot>;
  syncBySlot: Record<ProSlotId, SlotSyncState>;
  dirtyKeys: Partial<Record<ProTradeKey, true>>;
  upsertSnapshot: (snapshot: ProTradeSnapshot) => void;
  setSlotSync: (sync: SlotSyncState) => void;
  markDirtyByNostr: (slotId: ProSlotId, hint: OrderHint) => void;
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
