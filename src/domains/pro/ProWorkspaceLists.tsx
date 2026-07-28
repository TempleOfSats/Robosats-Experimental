import {
  CalendarClock,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  Clock3,
  Copy,
  Download,
  History,
  ListChecks,
  Pause,
  Play,
  Search,
  Send,
  Trash2,
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
import { toProTradePresentation } from "@/domains/pro/proPresentation";
import { deriveProRobotLifecycle } from "@/domains/pro/proRobotLifecycle";
import { summarizeProRobots } from "@/domains/pro/proSelectors";
import { FleetGlyph } from "@/domains/pro/ProWorkspaceIcons";
import type { ProTradeLocator, ProTradeSnapshot, SlotSyncState } from "@/domains/pro/pro.types";
import type { TradeHistoryEntry, TradeHistoryOutcome } from "@/domains/pro/tradeHistory";
import { formatLastRefresh, groupLabel } from "@/domains/pro/proWorkspacePresentation";
import { writeClipboard } from "@/lib/clipboard";
import { formatFiat, formatSats } from "@/lib/format";

export function TradeList({
  coordinators,
  onCancel,
  onCreate,
  onFindTrade,
  onOpen,
  onPause,
  onResume,
  quickActionKey,
  snapshots
}: {
  coordinators: CoordinatorSummary[];
  onCancel: (snapshot: ProTradeSnapshot) => void;
  onCreate: () => void;
  onFindTrade: () => void;
  onOpen: (locator: ProTradeLocator) => void;
  onPause: (snapshot: ProTradeSnapshot) => void;
  onResume: (snapshot: ProTradeSnapshot) => void;
  quickActionKey: string;
  snapshots: ProTradeSnapshot[];
}) {
  if (snapshots.length === 0) {
    return <TradeEmptyState onCreate={onCreate} onFindTrade={onFindTrade} />;
  }

  return (
    <div className="pro-trade-list" aria-label="Trades">
      <div className="pro-trade-header" aria-hidden="true">
        <span>Robot</span>
        <span>Order</span>
        <span>Coordinator</span>
        <span>Status</span>
        <span>Deadline</span>
        <span>Actions</span>
      </div>
      {snapshots.map((snapshot, index) => {
        const presentation = toProTradePresentation(snapshot);
        const StatusIcon = presentation.statusIcon;
        const coordinator = coordinators.find((item) => item.shortAlias === snapshot.locator.shortAlias);
        const previous = snapshots[index - 1];
        const showGroup = !previous || toProTradePresentation(previous).group !== presentation.group;
        const hasQuickActions = Boolean(
          snapshot.order?.is_maker && (snapshot.order.status === 1 || snapshot.order.status === 2)
        );
        return (
          <Fragment key={snapshot.key}>
            {showGroup ? <div className="pro-trade-group">{groupLabel(presentation.group)}</div> : null}
            <div className={hasQuickActions ? "pro-trade-row pro-trade-row-quick-actions" : "pro-trade-row"}>
              <button
                className="pro-trade-row-open"
                type="button"
                aria-label={`Open order ${snapshot.locator.orderId} for ${snapshot.nickname}`}
                onClick={() => onOpen(snapshot.locator)}
              >
                <span className="pro-trade-robot">
                  <RobotAvatar hashId={snapshot.hashId} label={snapshot.nickname} size="sm" />
                  <span><strong>{snapshot.nickname}</strong><small>{presentation.directionLabel}</small></span>
                </span>
                <span className="pro-trade-order" data-direction={presentation.directionLabel}>
                  <strong>{presentation.amountLabel}</strong>
                  <small>{presentation.methodLabel} · #{snapshot.locator.orderId}</small>
                </span>
                <span className="pro-trade-coordinator">
                  {coordinator ? <img className="coordinator-avatar coordinator-avatar-xs" src={coordinator.smallAvatarUrl} alt="" /> : null}
                  <span>{coordinator?.longAlias ?? snapshot.locator.shortAlias}</span>
                </span>
                <span>
                  <Badge tone={presentation.statusTone} icon={<StatusIcon size={12} />}>{presentation.statusLabel}</Badge>
                </span>
                <span className="pro-trade-deadline" title={formatExpiryTitle(snapshot.order?.expires_at)}>
                  <Clock3 size={15} aria-hidden="true" />
                  {presentation.deadline ? formatExpiryCountdown(snapshot.order?.expires_at) : "-"}
                </span>
              </button>
              <span className="pro-trade-actions">
                {snapshot.order?.status === 1 && snapshot.order.is_maker ? (
                  <>
                    <Button
                      aria-label={`Pause order ${snapshot.locator.orderId}`}
                      className="pro-trade-action-button"
                      disabled={Boolean(quickActionKey)}
                      loading={quickActionKey === `${snapshot.key}:pause`}
                      onClick={() => onPause(snapshot)}
                      size="sm"
                      title="Hide this offer from the public order book"
                      variant="outline"
                    >
                      <Pause size={14} /> <span className="pro-trade-action-label">Pause</span>
                    </Button>
                    <Button
                      aria-label={`Cancel order ${snapshot.locator.orderId}`}
                      className="pro-trade-action-button pro-trade-cancel-button"
                      disabled={Boolean(quickActionKey)}
                      onClick={() => onCancel(snapshot)}
                      size="sm"
                      title="Cancel this offer"
                      variant="destructive"
                    >
                      <X size={14} /> <span className="pro-trade-action-label">Cancel</span>
                    </Button>
                  </>
                ) : snapshot.order?.status === 2 && snapshot.order.is_maker ? (
                  <>
                    <Button
                      aria-label={`Resume order ${snapshot.locator.orderId}`}
                      className="pro-trade-action-button"
                      disabled={Boolean(quickActionKey)}
                      loading={quickActionKey === `${snapshot.key}:resume`}
                      onClick={() => onResume(snapshot)}
                      size="sm"
                      title="Return this offer to the public order book"
                      variant="outline"
                    >
                      <Play size={14} /> <span className="pro-trade-action-label">Resume</span>
                    </Button>
                    <OpenTradeButton onClick={() => onOpen(snapshot.locator)} orderId={snapshot.locator.orderId} />
                  </>
                ) : (
                  <OpenTradeButton onClick={() => onOpen(snapshot.locator)} orderId={snapshot.locator.orderId} />
                )}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

export function RobotList({
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
        <span className="pro-fleet-empty-mark" aria-hidden="true"><FleetGlyph size={28} /></span>
        <div className="pro-fleet-empty-copy">
          <strong>Your Robot Fleet is ready</strong>
          <p>Create multiple robots here to manage their offers and active trades in one place. Each has a portable token that works in any RoboSats frontend.</p>
          <p>Your Fleet key restores and synchronizes the same robots and offer presets across your devices.</p>
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
        return (
          <article className="pro-robot-row" key={summary.slotId}>
            <div className="pro-robot-identity">
              <button className="pro-robot-avatar-button" type="button" onClick={() => onSettings(summary.slotId)} aria-label={`Open ${summary.nickname} settings`}>
                <RobotAvatar hashId={summary.hashId} label={summary.nickname} size="md" />
              </button>
              <span>
                <strong>{summary.nickname}</strong>
                <span className="pro-robot-state">
                  {lifecycle.canOpenTrade ? (
                    <button
                      className="pro-robot-trade-status"
                      type="button"
                      onClick={() => onOpenTrade(summary.slotId)}
                      aria-label={`Open ${summary.nickname}'s ongoing trade`}
                    >
                      <Badge tone={lifecycle.statusTone}>{lifecycle.statusLabel}</Badge>
                    </button>
                  ) : (
                    <Badge tone={lifecycle.statusTone}>{lifecycle.statusLabel}</Badge>
                  )}
                  <small className="pro-robot-refresh-meta">
                    <span>{checkingStatus ? "Checking coordinators" : formatLastRefresh(lifecycle.statusTimestamp)}</span>
                  </small>
                </span>
              </span>
            </div>
            <div className="pro-robot-actions">
              <Button size="icon" variant="ghost" onClick={() => onDownload(summary.slotId)} aria-label={`Download ${summary.nickname} recovery JSON`} title="Download recovery JSON">
                <Download size={16} />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => onTelegram(summary.slotId)} aria-label={`Enable Telegram for ${summary.nickname}`} title="Enable Telegram">
                <Send size={16} />
              </Button>
              <Button
                aria-label={lifecycle.canStartOrder ? `Create an offer with ${summary.nickname}` : `${summary.nickname} is unavailable`}
                className="pro-robot-create-button"
                disabled={!lifecycle.canStartOrder}
                size="sm"
                onClick={() => onCreate(summary.slotId)}
                title={lifecycle.canStartOrder
                  ? `Create an offer with ${summary.nickname}`
                  : lifecycle.availability.message ?? "Finish this robot's current order before creating another offer"}
                variant="outline"
              >
                <CirclePlus size={16} /> <span className="pro-robot-action-label">Create offer</span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={!lifecycle.canRemove}
                onClick={() => onDelete(summary.slotId)}
                aria-label={`Remove ${summary.nickname} from Fleet`}
                title={!lifecycle.canRemove
                  ? lifecycle.availability.message ?? "Finish the current order before removing this robot"
                  : "Remove from Fleet"}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
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
          <p>Completed trades and collaborative cancellations will appear here.</p>
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
          <span>Completed</span>
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
                <span><strong>{entry.robotName}</strong><small>{entry.role === "buyer" ? "Bought BTC" : "Sold BTC"}</small></span>
              </span>
              <span className="pro-history-trade">
                <strong>{formatHistoryAmount(entry)}</strong>
                <small>{entry.paymentMethod || "Method not specified"} · #{entry.orderId}</small>
              </span>
              <span className="pro-history-coordinator">
                {coordinator ? <img className="coordinator-avatar coordinator-avatar-xs" src={coordinator.smallAvatarUrl} alt="" /> : null}
                <span>{coordinator?.longAlias ?? entry.coordinatorShortAlias}</span>
              </span>
              <span><Badge tone={outcome.tone} icon={<OutcomeIcon size={12} />}>{outcome.label}</Badge></span>
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
          panelClassName="confirm-sheet pro-history-detail"
        >
          <header className="garage-switcher-header">
            <div>
              <p className="app-eyebrow">Finished trade</p>
              <h3 id="pro-history-detail-title">Order #{selected.orderId}</h3>
            </div>
            <button className="icon-button" type="button" onClick={() => setSelected(undefined)} aria-label="Close trade history">
              <X size={18} />
            </button>
          </header>
          <div className="pro-history-detail-identity">
            <RobotAvatar hashId={selected.robotHashId} label={selected.robotName} size="md" />
            <span><strong>{selected.robotName}</strong><small>{selected.role === "buyer" ? "Bought BTC" : "Sold BTC"}</small></span>
            <Badge
              tone={historyOutcome(selected.outcome).tone}
              icon={historyOutcomeIcon(selected.outcome)}
            >
              {historyOutcome(selected.outcome).label}
            </Badge>
          </div>
          <dl className="pro-history-detail-list">
            <div><dt>Amount</dt><dd>{formatHistoryAmount(selected)}</dd></div>
            <div><dt>Payment method</dt><dd>{selected.paymentMethod || "Not specified"}</dd></div>
            <div><dt>Premium</dt><dd>{formatSignedPercent(selected.premium)}</dd></div>
            <div><dt>Bitcoin</dt><dd>{formatSats(selected.satoshis)}</dd></div>
            <div><dt>Role</dt><dd>{selected.origin === "maker" ? "Offer maker" : "Offer taker"}</dd></div>
            <div><dt>Coordinator</dt><dd>{coordinatorName(coordinators, selected.coordinatorShortAlias)}</dd></div>
            <div><dt>Completed</dt><dd>{new Date(selected.completedAt).toLocaleString()}</dd></div>
          </dl>
          {selected.settlementInvoice && selected.settlementInvoicePurpose ? (
            <section className="pro-history-invoice">
              <div>
                <strong>
                  {selected.settlementInvoicePurpose === "payout-received"
                    ? "Payout invoice"
                    : "Seller collateral invoice"}
                </strong>
                <small>
                  {selected.settlementInvoicePurpose === "payout-received"
                    ? "Bitcoin received through this invoice"
                    : "Bitcoin collateral paid through this invoice"}
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
          <p className="pro-history-retention-note">
            This summary is kept in your encrypted Fleet history. Banking details, peer identity and chat are not stored.
          </p>
        </Dialog>
      ) : null}
    </>
  );
}

function TradeEmptyState({
  onCreate,
  onFindTrade
}: {
  onCreate: () => void;
  onFindTrade: () => void;
}) {
  return (
    <div className="pro-empty-state">
      <ListChecks size={22} aria-hidden="true" />
      <div><strong>No matching trades</strong><p>Active trades and public offers for every robot will appear here.</p></div>
      <div>
        <Button size="sm" variant="secondary" onClick={onFindTrade}>
          <Search size={15} /> Find a trade
        </Button>
        <Button size="sm" variant="ghost" onClick={onCreate}>Create offer</Button>
      </div>
    </div>
  );
}

function OpenTradeButton({ onClick, orderId }: { onClick: () => void; orderId: number }) {
  return (
    <button className="pro-trade-open-icon" type="button" aria-label={`Open order ${orderId}`} onClick={onClick}>
      <ChevronRight size={18} />
    </button>
  );
}

function historyOutcome(outcome: TradeHistoryOutcome): {
  icon: typeof CircleCheck;
  label: string;
  tone: "success" | "warning" | "danger" | "muted";
} {
  if (outcome === "completed") return { icon: CircleCheck, label: "Completed", tone: "success" };
  return { icon: CalendarClock, label: "Cancelled together", tone: "muted" };
}

function historyOutcomeIcon(outcome: TradeHistoryOutcome) {
  const Icon = historyOutcome(outcome).icon;
  return <Icon size={12} />;
}

function formatHistoryAmount(entry: TradeHistoryEntry): string {
  if (entry.amount === undefined) return "Amount unavailable";
  const currency = currencyCodeFromId(entry.currency) ?? String(entry.currency);
  return entry.currency === 1000 ? formatSats(entry.amount) : formatFiat(entry.amount, currency);
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
