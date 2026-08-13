import {
  CalendarClock,
  CircleCheck,
  CirclePlus,
  Clock3,
  Copy,
  Download,
  Ellipsis,
  History,
  ListChecks,
  Pause,
  Play,
  Search,
  Send,
  Trash2,
  Trophy,
  WalletCards,
  X
} from "lucide-react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import type { RobotSlot } from "@/domains/garage/garageStore";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { formatExpiryCountdown, formatExpiryTitle } from "@/domains/orderbook/offerDisplay";
import { currencyCodeFromId } from "@/domains/orderbook/currencies";
import { matchedPaymentMethods } from "@/domains/orderbook/paymentMethods";
import { TradeReceipt, type TradeReceiptModel } from "@/domains/orders/TradeReceipt";
import { toProTradePresentation } from "@/domains/pro/proPresentation";
import { deriveProRobotLifecycle } from "@/domains/pro/proRobotLifecycle";
import { classifyProTrade, summarizeProRobots } from "@/domains/pro/proSelectors";
import { FleetGlyph } from "@/domains/pro/ProWorkspaceIcons";
import type { ProTradeLocator, ProTradeSnapshot, SlotSyncState } from "@/domains/pro/pro.types";
import type { TradeHistoryEntry, TradeHistoryOutcome } from "@/domains/pro/tradeHistory";
import { formatLastRefresh, groupLabel, proDeadlineTone } from "@/domains/pro/proWorkspacePresentation";
import { writeClipboard } from "@/lib/clipboard";
import { downloadTextFile } from "@/domains/transport/downloadFile";
import { formatFiat, formatSats } from "@/lib/format";

export function TradeList({
  coordinators,
  onCancel,
  onCreate,
  onFindTrade,
  onOpen,
  onPause,
  onClaimRewards,
  onResume,
  quickActionKey,
  rewardSlots,
  snapshots
}: {
  coordinators: CoordinatorSummary[];
  onCancel: (snapshot: ProTradeSnapshot) => void;
  onCreate: () => void;
  onFindTrade: () => void;
  onOpen: (locator: ProTradeLocator) => void;
  onPause: (snapshot: ProTradeSnapshot) => void;
  onClaimRewards: (slotId: string) => void;
  onResume: (snapshot: ProTradeSnapshot) => void;
  quickActionKey: string;
  rewardSlots: RobotSlot[];
  snapshots: ProTradeSnapshot[];
}) {
  if (snapshots.length === 0 && rewardSlots.length === 0) {
    return <TradeEmptyState onCreate={onCreate} onFindTrade={onFindTrade} />;
  }

  const showQuickActions = snapshots.some(hasTradeQuickActions);

  return (
    <div className="pro-trade-list" aria-label="Trades">
      {rewardSlots.length > 0 ? (
        <div className="pro-reward-action-group" aria-label="Robot rewards ready to claim">
          <div className="pro-trade-group">Rewards ready</div>
          {rewardSlots.map((slot) => (
            <div className="pro-reward-action-row" key={slot.tokenSHA256}>
              <span className="pro-reward-action-robot">
                <RobotAvatar hashId={slot.hashId} label={slot.nickname} size="sm" />
                <span>
                  <strong>{slot.nickname}</strong>
                  <small>Robot reward</small>
                </span>
              </span>
              <span className="pro-reward-action-amount">
                <Trophy size={16} aria-hidden="true" />
                <span>
                  <strong>{formatSats(slot.earnedRewards)}</strong>
                  <small>available for this robot</small>
                </span>
              </span>
              <Button onClick={() => onClaimRewards(slot.tokenSHA256)} size="sm" type="button" variant="outline">
                <WalletCards size={15} /> Claim
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {snapshots.length > 0 ? (
        <div
          className={showQuickActions ? "pro-trade-header" : "pro-trade-header pro-trade-header-no-actions"}
          aria-hidden="true"
        >
          <span>Robot</span>
          <span>Order</span>
          <span>Status</span>
          <span>Deadline</span>
          {showQuickActions ? <span>Actions</span> : null}
        </div>
      ) : null}
      {snapshots.map((snapshot, index) => (
        <ProTradeRow
          coordinators={coordinators}
          hasActionsColumn={showQuickActions}
          key={snapshot.key}
          onCancel={onCancel}
          onOpen={onOpen}
          onPause={onPause}
          onResume={onResume}
          previous={snapshots[index - 1]}
          quickActionKey={quickActionKey}
          snapshot={snapshot}
        />
      ))}
    </div>
  );
}

function ProTradeRow({
  coordinators,
  hasActionsColumn,
  onCancel,
  onOpen,
  onPause,
  onResume,
  previous,
  quickActionKey,
  snapshot
}: {
  coordinators: CoordinatorSummary[];
  hasActionsColumn: boolean;
  onCancel: (snapshot: ProTradeSnapshot) => void;
  onOpen: (locator: ProTradeLocator) => void;
  onPause: (snapshot: ProTradeSnapshot) => void;
  onResume: (snapshot: ProTradeSnapshot) => void;
  previous?: ProTradeSnapshot;
  quickActionKey: string;
  snapshot: ProTradeSnapshot;
}) {
  const presentation = toProTradePresentation(snapshot);
  const StatusIcon = presentation.statusIcon;
  const coordinator = coordinators.find((item) => item.shortAlias === snapshot.locator.shortAlias);
  const coordinatorName = coordinator?.longAlias ?? snapshot.locator.shortAlias;
  const showGroup = !previous || toProTradePresentation(previous).group !== presentation.group;
  const hasQuickActions = hasTradeQuickActions(snapshot);
  const deadlineTone = proDeadlineTone(presentation.deadline);

  return (
    <Fragment>
      {showGroup ? <div className="pro-trade-group">{groupLabel(presentation.group)}</div> : null}
      <div
        className={`pro-trade-row${hasQuickActions ? " pro-trade-row-quick-actions" : ""}${hasActionsColumn ? "" : " pro-trade-row-no-actions"}`}
        data-actionable={presentation.actionable || undefined}
        data-status-tone={presentation.statusTone}
      >
        <button
          className="pro-trade-row-open"
          type="button"
          aria-label={`Open order ${snapshot.locator.orderId} for ${snapshot.nickname}, hosted by ${coordinatorName}`}
          onClick={() => onOpen(snapshot.locator)}
        >
          <span className="pro-trade-robot">
            <RobotAvatar hashId={snapshot.hashId} label={snapshot.nickname} size="sm" />
            <span>
              <strong>{snapshot.nickname}</strong>
              <small>{presentation.directionLabel}</small>
            </span>
          </span>
          <span className="pro-trade-order" data-direction={presentation.directionLabel}>
            <strong>{presentation.amountLabel}</strong>
            <small className="pro-trade-order-meta">
              <span>
                {presentation.methodLabel} · #{snapshot.locator.orderId}
              </span>
              <span className="pro-trade-coordinator" title={coordinatorName}>
                {coordinator ? (
                  <img className="coordinator-avatar coordinator-avatar-xs" src={coordinator.smallAvatarUrl} alt="" />
                ) : (
                  <span className="pro-trade-coordinator-fallback" aria-hidden="true">
                    {snapshot.locator.shortAlias.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="pro-trade-coordinator-name">{coordinatorName}</span>
              </span>
            </small>
          </span>
          <span className="pro-trade-status">
            <Badge tone={presentation.statusTone} icon={<StatusIcon size={12} />}>
              {presentation.statusLabel}
            </Badge>
          </span>
          <span
            className="pro-trade-deadline"
            data-tone={deadlineTone}
            title={formatExpiryTitle(snapshot.order?.expires_at)}
          >
            <span className="pro-trade-deadline-signal" aria-hidden="true" />
            <Clock3 size={15} aria-hidden="true" />
            {presentation.deadline ? formatExpiryCountdown(snapshot.order?.expires_at) : "-"}
          </span>
        </button>
        <ProTradeQuickActions
          enabled={hasActionsColumn}
          onCancel={onCancel}
          onPause={onPause}
          onResume={onResume}
          quickActionKey={quickActionKey}
          snapshot={snapshot}
        />
      </div>
    </Fragment>
  );
}

function ProTradeQuickActions({
  enabled,
  onCancel,
  onPause,
  onResume,
  quickActionKey,
  snapshot
}: {
  enabled: boolean;
  onCancel: (snapshot: ProTradeSnapshot) => void;
  onPause: (snapshot: ProTradeSnapshot) => void;
  onResume: (snapshot: ProTradeSnapshot) => void;
  quickActionKey: string;
  snapshot: ProTradeSnapshot;
}) {
  if (!enabled) return null;

  if (snapshot.order?.status === 1 && snapshot.order.is_maker) {
    return (
      <span className="pro-trade-actions">
        <Button
          aria-label={`Pause order ${snapshot.locator.orderId}`}
          className="pro-trade-action-button"
          disabled={Boolean(quickActionKey)}
          loading={quickActionKey === `${snapshot.key}:pause`}
          onClick={() => onPause(snapshot)}
          size="icon"
          title="Hide this offer from the public order book"
          variant="outline"
        >
          <Pause size={15} />
        </Button>
        <Button
          aria-label={`Cancel order ${snapshot.locator.orderId}`}
          className="pro-trade-action-button pro-trade-cancel-button"
          disabled={Boolean(quickActionKey)}
          onClick={() => onCancel(snapshot)}
          size="icon"
          title="Cancel this offer"
          variant="destructive"
        >
          <X size={15} />
        </Button>
      </span>
    );
  }

  if (snapshot.order?.status === 2 && snapshot.order.is_maker) {
    return (
      <span className="pro-trade-actions">
        <Button
          aria-label={`Resume order ${snapshot.locator.orderId}`}
          className="pro-trade-action-button"
          disabled={Boolean(quickActionKey)}
          loading={quickActionKey === `${snapshot.key}:resume`}
          onClick={() => onResume(snapshot)}
          size="icon"
          title="Return this offer to the public order book"
          variant="outline"
        >
          <Play size={15} />
        </Button>
      </span>
    );
  }

  return <span className="pro-trade-actions" />;
}

export function RobotList({
  onAddRobot,
  onCreate,
  onDelete,
  onDownload,
  onOpenTrade,
  onSettings,
  onTelegram,
  slots,
  snapshots,
  summaries,
  syncBySlot
}: {
  onAddRobot?: () => void;
  onCreate: (slotId: string) => void;
  onDelete: (slotId: string) => void;
  onDownload: (slotId: string) => void;
  onOpenTrade: (slotId: string) => void;
  onSettings: (slotId: string) => void;
  onTelegram: (slotId: string) => void;
  slots: RobotSlot[];
  snapshots: Record<string, ProTradeSnapshot>;
  summaries: ReturnType<typeof summarizeProRobots>;
  syncBySlot: Record<string, SlotSyncState>;
}) {
  if (slots.length === 0) {
    return (
      <div className="pro-empty-state pro-fleet-empty-state">
        <div className="pro-fleet-empty-visual" aria-hidden="true">
          <RobotAvatar hashId="a83d2f" label="" size="md" />
          <RobotAvatar hashId="3c7ab9" label="" size="md" />
          <RobotAvatar hashId="d09841" label="" size="md" />
          <span className="pro-fleet-empty-mark">
            <FleetGlyph size={22} />
          </span>
        </div>
        <div className="pro-fleet-empty-copy">
          <strong>Your Robot Fleet is ready</strong>
          <p>Build a lineup of separate robot identities, then run every trade from this desk.</p>
          <p>
            Each robot remains a separate RoboSats identity. Your Fleet key reconnects the collection through encrypted
            sync; an offline Fleet backup can restore its saved robots without relays.
          </p>
          {onAddRobot ? (
            <Button className="pro-fleet-empty-action" onClick={onAddRobot} size="sm">
              <CirclePlus size={16} /> Add your first robot
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="pro-robot-list">
      {summaries.map((summary) => {
        const slot = slots.find((item) => item.tokenSHA256 === summary.slotId);
        const sync = syncBySlot[summary.slotId];
        if (!slot) return null;
        const lifecycle = deriveProRobotLifecycle(slot, snapshots, sync);
        const checkingStatus = lifecycle.status === "checking";
        const tradeIdentifier = fleetTradeIdentifier(summary.slotId, snapshots, lifecycle.status);
        return (
          <article className="pro-robot-row" key={summary.slotId}>
            <div className="pro-robot-identity">
              <button
                className="pro-robot-avatar-button"
                type="button"
                onClick={() => onSettings(summary.slotId)}
                aria-label={`Open ${summary.nickname} settings`}
              >
                <RobotAvatar hashId={summary.hashId} label={summary.nickname} size="md" />
              </button>
              <span>
                <strong>{summary.nickname}</strong>
                <span className="pro-robot-state">
                  <Badge tone={lifecycle.statusTone}>{lifecycle.statusLabel}</Badge>
                  {tradeIdentifier ? (
                    <small className="pro-robot-trade-identity" aria-label={tradeIdentifier.label}>
                      <span className="pro-robot-trade-amount">{tradeIdentifier.amount}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="pro-robot-trade-method">{tradeIdentifier.method}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="pro-robot-trade-order">#{tradeIdentifier.orderId}</span>
                    </small>
                  ) : null}
                  <small className="pro-robot-refresh-meta">
                    <span>
                      {checkingStatus ? "Checking coordinators" : formatLastRefresh(lifecycle.statusTimestamp)}
                    </span>
                  </small>
                </span>
              </span>
            </div>
            <div className="pro-robot-actions">
              {lifecycle.canOpenTrade ? (
                <Button
                  aria-label={`Open trade with ${summary.nickname}`}
                  className="pro-robot-primary-action pro-robot-open-button"
                  onClick={() => onOpenTrade(summary.slotId)}
                  size="sm"
                  variant={lifecycle.status === "needs-attention" ? "primary" : "outline"}
                >
                  Open trade
                </Button>
              ) : lifecycle.canStartOrder ? (
                <Button
                  aria-label={`Create an offer with ${summary.nickname}`}
                  className="pro-robot-primary-action pro-robot-create-button"
                  size="sm"
                  onClick={() => onCreate(summary.slotId)}
                  title={`Create an offer with ${summary.nickname}`}
                  variant="outline"
                >
                  <CirclePlus size={16} /> Create offer
                </Button>
              ) : null}
              <details className="pro-robot-more">
                <summary aria-label={`More actions for ${summary.nickname}`} title="More robot actions">
                  <Ellipsis size={18} />
                </summary>
                <div className="pro-robot-more-menu">
                  <button
                    type="button"
                    onClick={(event) => {
                      closeRobotActions(event.currentTarget);
                      onDownload(summary.slotId);
                    }}
                  >
                    <Download size={15} /> Download backup
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      closeRobotActions(event.currentTarget);
                      onTelegram(summary.slotId);
                    }}
                  >
                    <Send size={15} /> Telegram alerts
                  </button>
                  <button
                    disabled={!lifecycle.canRemove}
                    type="button"
                    title={
                      !lifecycle.canRemove
                        ? (lifecycle.availability.message ?? "Finish the current order before removing this robot")
                        : "Remove from Fleet"
                    }
                    onClick={(event) => {
                      closeRobotActions(event.currentTarget);
                      onDelete(summary.slotId);
                    }}
                  >
                    <Trash2 size={15} /> Remove from Fleet
                  </button>
                </div>
              </details>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function closeRobotActions(trigger: HTMLButtonElement) {
  const details = trigger.closest("details");
  const summary = details?.querySelector<HTMLElement>("summary");
  details?.removeAttribute("open");
  summary?.focus();
}

function fleetTradeIdentifier(
  slotId: string,
  snapshots: Record<string, ProTradeSnapshot>,
  lifecycleStatus: "ongoing" | "needs-attention" | string
): { label: string; amount: string; method: string; orderId: number } | undefined {
  if (lifecycleStatus !== "ongoing" && lifecycleStatus !== "needs-attention") return undefined;
  const snapshot = Object.values(snapshots).find(
    (candidate) =>
      candidate.locator.slotId === slotId &&
      !candidate.released &&
      !candidate.renewable &&
      candidate.order &&
      (classifyProTrade(candidate) === "in-progress" || classifyProTrade(candidate) === "needs-action")
  );
  const order = snapshot?.order;
  const currency = order ? currencyCodeFromId(order.currency) : undefined;
  if (!snapshot || !order || !currency || order.amount == null || Number.isNaN(order.amount)) return undefined;
  const currencyFormatter = new Intl.NumberFormat(undefined, {
    currency,
    currencyDisplay: "narrowSymbol",
    style: "currency"
  });
  const symbol = currencyFormatter.formatToParts(0).find((part) => part.type === "currency")?.value;
  if (!symbol) return undefined;
  const amount = `${symbol}${formatFiat(order.amount)}`;
  const method = matchedPaymentMethods(order.payment_method)[0]?.name || order.payment_method.trim();
  if (!method) return undefined;
  return {
    amount,
    label: `${amount} · ${method} · #${snapshot.locator.orderId}`,
    method,
    orderId: snapshot.locator.orderId
  };
}

export function HistoryList({
  coordinators,
  entries
}: {
  coordinators: CoordinatorSummary[];
  entries: TradeHistoryEntry[];
}) {
  const [selected, setSelected] = useState<TradeHistoryEntry>();
  const [copiedInvoice, setCopiedInvoice] = useState(false);
  if (entries.length === 0) {
    return (
      <div className="pro-empty-state pro-history-empty-state">
        <span className="pro-history-empty-mark" aria-hidden="true">
          <History size={22} />
        </span>
        <div className="pro-history-empty-copy">
          <strong>No completed trades yet</strong>
          <p>Completed trades, collaborative cancellations and dispute results will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pro-history-list" aria-label="Finished trade history">
        <div className="pro-history-header" aria-hidden="true">
          <span>Robot</span>
          <span>Trade</span>
          <span>Coordinator</span>
          <span>Result</span>
          <span>Result date</span>
        </div>
        {entries.map((entry) => {
          const coordinator = coordinators.find((item) => item.shortAlias === entry.coordinatorShortAlias);
          const outcome = historyOutcome(entry.outcome);
          const OutcomeIcon = outcome.icon;
          return (
            <button
              className="pro-history-row"
              key={entry.id}
              type="button"
              onClick={() => {
                setCopiedInvoice(false);
                setSelected(entry);
              }}
              aria-label={`Open finished order ${entry.orderId} for ${entry.robotName}`}
            >
              <span className="pro-history-robot">
                <RobotAvatar hashId={entry.robotHashId} label={entry.robotName} size="sm" />
                <span>
                  <strong>{entry.robotName}</strong>
                  <small>
                    {entry.currency === 1000 ? "Bitcoin swap" : entry.role === "buyer" ? "Bought BTC" : "Sold BTC"}
                  </small>
                </span>
              </span>
              <span className="pro-history-trade">
                <strong>{formatHistoryAmount(entry)}</strong>
                <small>
                  {entry.paymentMethod || "Method not specified"} · #{entry.orderId}
                </small>
              </span>
              <span className="pro-history-coordinator">
                {coordinator ? (
                  <img className="coordinator-avatar coordinator-avatar-xs" src={coordinator.smallAvatarUrl} alt="" />
                ) : null}
                <span>{coordinator?.longAlias ?? entry.coordinatorShortAlias}</span>
              </span>
              <span>
                <Badge tone={outcome.tone} icon={<OutcomeIcon size={12} />}>
                  {outcome.label}
                </Badge>
              </span>
              <span className="pro-history-date">{formatHistoryDate(entry.completedAt)}</span>
            </button>
          );
        })}
      </div>
      {selected ? (
        <Dialog
          ariaLabelledby="pro-history-detail-title"
          onClose={() => setSelected(undefined)}
          overlayClassName="pro-trade-dialog-overlay"
          panelClassName="confirm-sheet pro-history-detail pro-history-receipt-dialog"
        >
          <button
            className="icon-button pro-history-detail-close"
            type="button"
            onClick={() => setSelected(undefined)}
            aria-label="Close trade history"
          >
            <X size={18} />
          </button>
          <TradeReceipt
            actions={
              <Button
                className="trade-receipt-secondary-only"
                onClick={() => downloadHistoryOverview(selected)}
                variant="outline"
              >
                <Download size={15} /> Download overview
              </Button>
            }
            focusTitle
            model={historyTradeReceipt(selected, coordinatorName(coordinators, selected.coordinatorShortAlias))}
            titleId="pro-history-detail-title"
            breakdown={
              <>
                <dl className="pro-history-detail-list">
                  <div>
                    <dt>Offer role</dt>
                    <dd>{selected.origin === "maker" ? "Offer maker" : "Offer taker"}</dd>
                  </div>
                  <div>
                    <dt>Premium</dt>
                    <dd>{formatSignedPercent(selected.premium)}</dd>
                  </div>
                </dl>
                {selected.settlementInvoice && selected.settlementInvoicePurpose ? (
                  <section className="pro-history-invoice">
                    <div>
                      <strong>
                        {selected.settlementInvoicePurpose === "payout-received" ? "Payout invoice" : "Escrow invoice"}
                      </strong>
                      <small>
                        {selected.settlementInvoicePurpose === "payout-received"
                          ? "Bitcoin received through this invoice"
                          : "Escrow paid through this invoice"}
                      </small>
                    </div>
                    <code>{selected.settlementInvoice}</code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void writeClipboard(selected.settlementInvoice!)
                          .then(() => setCopiedInvoice(true))
                          .catch(() => setCopiedInvoice(false));
                      }}
                    >
                      <Copy size={14} /> {copiedInvoice ? "Copied" : "Copy invoice"}
                    </Button>
                  </section>
                ) : null}
              </>
            }
          />
        </Dialog>
      ) : null}
    </>
  );
}

function TradeEmptyState({ onCreate, onFindTrade }: { onCreate: () => void; onFindTrade: () => void }) {
  return (
    <div className="pro-empty-state">
      <ListChecks size={22} aria-hidden="true" />
      <div>
        <strong>No matching trades</strong>
        <p>Active trades and public offers for every robot will appear here.</p>
      </div>
      <div>
        <Button size="sm" variant="secondary" onClick={onFindTrade}>
          <Search size={15} /> Find a trade
        </Button>
        <Button size="sm" variant="ghost" onClick={onCreate}>
          Create offer
        </Button>
      </div>
    </div>
  );
}

function hasTradeQuickActions(snapshot: ProTradeSnapshot): boolean {
  return Boolean(snapshot.order?.is_maker && (snapshot.order.status === 1 || snapshot.order.status === 2));
}

function historyOutcome(outcome: TradeHistoryOutcome): {
  icon: typeof CircleCheck;
  label: string;
  tone: "success" | "warning" | "danger" | "muted";
} {
  if (outcome === "completed") return { icon: CircleCheck, label: "Completed", tone: "success" };
  if (outcome === "dispute-won") return { icon: Trophy, label: "Dispute won", tone: "success" };
  if (outcome === "dispute-lost") return { icon: X, label: "Dispute lost", tone: "danger" };
  return { icon: CalendarClock, label: "Cancelled together", tone: "muted" };
}

function formatHistoryAmount(entry: TradeHistoryEntry): string {
  if (entry.amount === undefined) return "Amount unavailable";
  const currency = currencyCodeFromId(entry.currency) ?? String(entry.currency);
  return entry.currency === 1000
    ? formatSats(Math.round(entry.amount * 100_000_000))
    : formatFiat(entry.amount, currency);
}

function formatHistorySats(value: number): string {
  return value > 0 ? formatSats(value) : "Not recorded";
}

function historyTradeReceipt(entry: TradeHistoryEntry, hostName: string): TradeReceiptModel {
  const identity = {
    robotName: entry.robotName,
    robotHashId: entry.robotHashId,
    orderId: entry.orderId,
    coordinatorName: hostName,
    timestamp: new Date(entry.completedAt).toLocaleString()
  };
  const fiat = formatHistoryAmount(entry);
  const bitcoin = formatHistorySats(entry.satoshis);
  const isBitcoinSwap = entry.currency === 1000;
  const context =
    entry.amount === undefined
      ? undefined
      : `${isBitcoinSwap && entry.role === "buyer" ? "after sending" : "for"} ${fiat}`;
  const contractRows = [
    { label: isBitcoinSwap ? "Contract amount" : "Contract fiat", value: fiat },
    { label: isBitcoinSwap ? "Bitcoin settlement" : "Contract bitcoin", value: bitcoin }
  ];

  if (entry.outcome === "collaboratively-cancelled") {
    return {
      ...identity,
      outcome: "cancelled",
      title: "Collaboratively cancelled",
      statementLabel: "Both robots agreed to cancel",
      primaryValue: "No payout",
      statementContext: "Both peers' bonds were returned without penalty. The trade ended without a bitcoin payout.",
      rows: contractRows
    };
  }
  if (entry.outcome === "dispute-won" || entry.outcome === "dispute-lost") {
    const won = entry.outcome === "dispute-won";
    return {
      ...identity,
      outcome: won ? "dispute-won" : "dispute-lost",
      title: won ? "Dispute resolved in your favor" : "Dispute resolved for your peer",
      statementLabel: "Coordinator decision",
      primaryValue: won ? "Your robot won" : "Your peer won",
      statementContext: "This history records the contract amount, not an attributed dispute award.",
      rows: contractRows
    };
  }
  return {
    ...identity,
    outcome: "completed",
    title: isBitcoinSwap ? "Bitcoin swap completed" : "Trade completed",
    statementLabel: isBitcoinSwap
      ? `Bitcoin ${entry.role === "buyer" ? "received" : "sent"}`
      : `You ${entry.role === "buyer" ? "bought" : "sold"} bitcoin`,
    primaryValue: bitcoin,
    statementContext: context,
    rows: contractRows
  };
}

function downloadHistoryOverview(entry: TradeHistoryEntry) {
  const overview = {
    format: "robosats-trade-history-overview",
    version: 1,
    order_id: entry.orderId,
    robot: entry.robotName,
    coordinator: entry.coordinatorShortAlias,
    role: entry.role,
    origin: entry.origin,
    amount: entry.amount,
    currency: entry.currency,
    payment_method: entry.paymentMethod,
    premium_percent: entry.premium,
    contract_satoshis: entry.satoshis,
    outcome: entry.outcome,
    completed_at: entry.completedAt
  };
  downloadTextFile(
    `robosats-trade-${entry.orderId}-overview.json`,
    JSON.stringify(overview, null, 2),
    "application/json"
  );
}

function formatHistoryDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value);
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function coordinatorName(coordinators: CoordinatorSummary[], shortAlias: string): string {
  return coordinators.find((item) => item.shortAlias === shortAlias)?.longAlias ?? shortAlias;
}
