import { useGarageStore, type RobotSlot } from "@/domains/garage/garageStore";
import {
  replayCoordinatorOrderActivity,
  subscribeCoordinatorOrderActivity,
  type CoordinatorOrderObservation
} from "@/domains/orders/orderActivity";
import type { OrderDto } from "@/domains/orders/order.types";
import { hasFailedPayoutForCurrentRobot } from "@/domains/orders/orderStateMachine";
import { selectProGarageSlots, useGarageVaultStore } from "@/domains/pro/garageVaultStore";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import { proTradeKey, type ProTradeLocator, type ProTradeSnapshot } from "@/domains/pro/pro.types";

export function startProOrderActivityBridge(): () => void {
  const consume = (observation: CoordinatorOrderObservation) => {
    const vault = useGarageVaultStore.getState();
    const slot = selectProGarageSlots(useGarageStore.getState().slots, vault.manifest)
      .find((candidate) => candidate.tokenSHA256 === observation.slotId);
    if (!slot) return;
    applyProOrderSnapshot({
      slot,
      shortAlias: observation.shortAlias,
      order: observation.order,
      authoritative: observation.authoritative,
      observedAt: observation.observedAt,
      synchronizeGarage: false
    });
  };

  const unsubscribeActivity = subscribeCoordinatorOrderActivity(consume, { replay: true });
  const unsubscribeVault = useGarageVaultStore.subscribe((state, previous) => {
    const becameReady = state.status === "ready" && previous.status !== "ready";
    const manifestChanged = state.status === "ready" && state.manifest?.revision !== previous.manifest?.revision;
    if (becameReady || manifestChanged) replayCoordinatorOrderActivity(consume);
  });
  return () => {
    unsubscribeActivity();
    unsubscribeVault();
  };
}

export function applyProOrderSnapshot({
  activeOrderId,
  authoritative,
  lastOrderId,
  observedAt = Date.now(),
  order,
  releasePublicTake = false,
  shortAlias,
  slot,
  synchronizeGarage = true
}: {
  activeOrderId?: number;
  authoritative: boolean;
  lastOrderId?: number;
  observedAt?: number;
  order: OrderDto;
  releasePublicTake?: boolean;
  shortAlias: string;
  slot: RobotSlot;
  synchronizeGarage?: boolean;
}): "upserted" | "removed" {
  const locator: ProTradeLocator = { slotId: slot.tokenSHA256, shortAlias, orderId: order.id };
  const tradeIndex = useProTradeIndexStore.getState();
  const previous = tradeIndex.snapshots[proTradeKey(locator)];
  if (!authoritative && previous?.freshness === "fresh") return "upserted";

  if (synchronizeGarage) {
    useGarageStore.getState().syncOrderSnapshot({
      token: slot.token,
      shortAlias,
      orderId: order.id,
      status: order.status,
      isMaker: order.is_maker,
      hasFailedPayout: hasFailedPayoutForCurrentRobot(order)
    });
  }
  const currentSlot = useGarageStore.getState().slots.find((candidate) => candidate.tokenSHA256 === slot.tokenSHA256) ?? slot;
  const robot = currentSlot.robots[shortAlias];
  const released = releasePublicTake || (
    order.status === 1
    && !order.is_maker
    && !order.is_taker
    && (robot?.activeOrderId === order.id || robot?.releasedOrderId === order.id)
  );
  if (released) {
    useGarageStore.getState().releaseOrderReservation(slot.token, shortAlias, order.id);
    tradeIndex.removeTrade(locator);
    return "removed";
  }

  const renewable = order.status === 5 && order.is_maker;
  const settlement = settlementForSnapshot(order, previous);
  if (!renewable && isTerminalForProDesk(
    order.status,
    order.is_maker,
    hasFailedPayoutForCurrentRobot(order)
  )) {
    useGarageVaultStore.getState().archiveTrade({
      slotId: slot.tokenSHA256,
      robotName: currentSlot.nickname,
      robotHashId: currentSlot.hashId,
      coordinatorShortAlias: shortAlias,
      order,
      ...settlement,
      observedAt
    });
    tradeIndex.removeTrade(locator);
    return "removed";
  }

  const key = proTradeKey(locator);
  const changed = !previous?.order || orderChanged(previous.order, order);
  const snapshot: ProTradeSnapshot = {
    key,
    locator,
    nickname: currentSlot.nickname,
    hashId: currentSlot.hashId,
    order: { ...order, shortAlias },
    activeOrderId: activeOrderId ?? robot?.activeOrderId,
    lastOrderId: lastOrderId ?? robot?.lastOrderId,
    renewable,
    released: false,
    freshness: authoritative ? "fresh" : "refreshing",
    ...settlement,
    updatedAt: observedAt,
    changedAt: changed ? observedAt : previous.changedAt,
    errorCode: undefined
  };
  tradeIndex.upsertSnapshot(snapshot);
  if (authoritative) tradeIndex.clearDirty(locator);
  return "upserted";
}

export function recordProSettlementInvoice(
  locator: ProTradeLocator,
  purpose: "payout-received" | "escrow-paid",
  value: string
): boolean {
  const invoice = cleanSettlementInvoice(value);
  const tradeIndex = useProTradeIndexStore.getState();
  const snapshot = tradeIndex.snapshots[proTradeKey(locator)];
  const roleMatches = snapshot?.order
    && ((snapshot.order.is_buyer && purpose === "payout-received")
      || (snapshot.order.is_seller && purpose === "escrow-paid"));
  if (!invoice || !snapshot || !roleMatches) return false;
  tradeIndex.upsertSnapshot({
    ...snapshot,
    settlementInvoice: invoice,
    settlementInvoicePurpose: purpose
  });
  return true;
}

export function isTerminalForProDesk(
  status: number,
  isMaker: boolean,
  hasFailedPayout?: boolean
): boolean {
  return [4, 12, 14, 17, 18].includes(status)
    || (status === 5 && !isMaker)
    || (status === 15 && hasFailedPayout === false);
}

function orderChanged(previous: OrderDto, current: OrderDto): boolean {
  return previous.status !== current.status
    || previous.expires_at !== current.expires_at
    || previous.amount !== current.amount
    || previous.min_amount !== current.min_amount
    || previous.max_amount !== current.max_amount
    || previous.payment_method !== current.payment_method;
}

function settlementForSnapshot(
  order: OrderDto,
  previous: ProTradeSnapshot | undefined
): Pick<ProTradeSnapshot, "settlementInvoice" | "settlementInvoicePurpose"> {
  const paidEscrowInvoice = order.is_seller && order.escrow_locked
    ? cleanSettlementInvoice(order.escrow_invoice)
    : undefined;
  if (paidEscrowInvoice) {
    return {
      settlementInvoice: paidEscrowInvoice,
      settlementInvoicePurpose: "escrow-paid"
    };
  }
  if (previous?.settlementInvoice && previous.settlementInvoicePurpose) {
    return {
      settlementInvoice: previous.settlementInvoice,
      settlementInvoicePurpose: previous.settlementInvoicePurpose
    };
  }
  return {};
}

function cleanSettlementInvoice(value: string | undefined): string | undefined {
  const invoice = value?.trim();
  return invoice
    && invoice.length >= 20
    && invoice.length <= 4_096
    && /^ln[a-z0-9]+$/i.test(invoice)
    ? invoice
    : undefined;
}
