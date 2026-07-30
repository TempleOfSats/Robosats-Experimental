import { useGarageStore, type RobotSlot } from "@/domains/garage/garageStore";
import {
  replayCoordinatorSettlementActivity,
  replayCoordinatorOrderActivity,
  subscribeCoordinatorOrderActivity,
  subscribeCoordinatorSettlementActivity,
  type CoordinatorSettlementObservation,
  type CoordinatorOrderObservation
} from "@/domains/orders/orderActivity";
import type { OrderDto } from "@/domains/orders/order.types";
import {
  isTerminalOrderForCurrentRobot
} from "@/domains/orders/orderStateMachine";
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

  const consumeSettlement = (observation: CoordinatorSettlementObservation) => {
    recordProSettlementInvoice(
      {
        slotId: observation.slotId,
        shortAlias: observation.shortAlias,
        orderId: observation.orderId
      },
      observation.purpose,
      observation.value
    );
  };

  const unsubscribeActivity = subscribeCoordinatorOrderActivity(consume, { replay: true });
  const unsubscribeSettlement = subscribeCoordinatorSettlementActivity(consumeSettlement, { replay: true });
  const unsubscribeVault = useGarageVaultStore.subscribe((state, previous) => {
    const envelopeBecameAvailable = Boolean(state.envelope && !previous.envelope);
    const fleetChanged = Boolean(state.envelope)
      && state.manifest?.revision !== previous.manifest?.revision;
    if (envelopeBecameAvailable || fleetChanged) {
      replayCoordinatorOrderActivity(consume);
      replayCoordinatorSettlementActivity(consumeSettlement);
    }
  });
  return () => {
    unsubscribeActivity();
    unsubscribeSettlement();
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
      isSeller: order.is_seller
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
    order.is_seller
  )) {
    const archiveResult = useGarageVaultStore.getState().archiveTrade({
      slotId: slot.tokenSHA256,
      robotName: currentSlot.nickname,
      robotHashId: currentSlot.hashId,
      coordinatorShortAlias: shortAlias,
      order,
      ...settlement,
      observedAt
    });
    if (archiveResult !== "deferred") {
      tradeIndex.removeTrade(locator);
      return "removed";
    }
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

function isTerminalForProDesk(
  status: number,
  isMaker: boolean,
  isSeller?: boolean
): boolean {
  return isTerminalOrderForCurrentRobot({ status, isMaker, isSeller });
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
