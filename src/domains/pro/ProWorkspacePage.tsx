import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  Clock3,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Store
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { useGarageStore } from "@/domains/garage/garageStore";
import { formatExpiryCountdown, formatExpiryTitle } from "@/domains/orderbook/offerDisplay";
import { garageReconciler } from "@/domains/pro/garageReconciler";
import { toProTradePresentation } from "@/domains/pro/proPresentation";
import { useProPreferencesStore, type ProFilter, type ProView } from "@/domains/pro/proPreferencesStore";
import {
  classifyProTrade,
  selectRelevantTrades,
  summarizeProRobots
} from "@/domains/pro/proSelectors";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import type { ProTradeLocator, ProTradeSnapshot } from "@/domains/pro/pro.types";
import "@/domains/pro/proWorkspace.css";

const summaryItems: Array<{
  key: Exclude<ProFilter, "all">;
  label: string;
  icon: typeof AlertTriangle;
}> = [
  { key: "needs-action", label: "Needs action", icon: AlertTriangle },
  { key: "active", label: "Active trades", icon: BriefcaseBusiness },
  { key: "public", label: "Public offers", icon: Store },
  { key: "renewable", label: "Renewable", icon: RotateCcw }
];

export function ProWorkspacePage() {
  const enabled = useProPreferencesStore((state) => state.enabled);
  const lastView = useProPreferencesStore((state) => state.lastView);
  const filter = useProPreferencesStore((state) => state.lastFilter);
  const setLastView = useProPreferencesStore((state) => state.setLastView);
  const setFilter = useProPreferencesStore((state) => state.setLastFilter);
  const slots = useGarageStore((state) => state.slots);
  const hydrated = useGarageStore((state) => state.hydrated);
  const hydrate = useGarageStore((state) => state.hydrate);
  const setCurrentToken = useGarageStore((state) => state.setCurrentToken);
  const coordinators = useFederationStore((state) => state.coordinators);
  const snapshots = useProTradeIndexStore((state) => state.snapshots);
  const syncBySlot = useProTradeIndexStore((state) => state.syncBySlot);
  const removeTrade = useProTradeIndexStore((state) => state.removeTrade);
  const navigate = useNavigate();
  const [robotFilter, setRobotFilter] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const tradesTab = useRef<HTMLButtonElement>(null);
  const robotsTab = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!enabled) return;
    hydrate();
  }, [enabled, hydrate]);

  const trades = useMemo(() => selectRelevantTrades(snapshots), [snapshots]);
  const robotSummaries = useMemo(() => summarizeProRobots(slots, snapshots), [slots, snapshots]);
  const filteredTrades = useMemo(
    () => trades.filter((snapshot) => matchesFilter(snapshot, filter, robotFilter)),
    [filter, robotFilter, trades]
  );
  const counts = useMemo(() => summaryCounts(trades), [trades]);
  const failedRobotNames = useMemo(() => robotSummaries
    .filter((summary) => Boolean(syncBySlot[summary.slotId]?.error))
    .map((summary) => summary.nickname), [robotSummaries, syncBySlot]);
  const refreshing = Object.values(syncBySlot).some((sync) => sync.inFlight);

  if (!enabled) return <Navigate to="/garage" replace />;

  function selectView(view: ProView) {
    setLastView(view);
    if (view === "robots") {
      setRobotFilter(undefined);
    }
  }

  function selectSummaryFilter(next: Exclude<ProFilter, "all">) {
    setLastView("trades");
    setRobotFilter(undefined);
    setFilter(filter === next ? "all" : next);
  }

  function selectRobot(slotId: string) {
    setLastView("trades");
    setFilter("all");
    setRobotFilter(slotId);
  }

  function useRobot(slotId: string, path: string) {
    const slot = slots.find((item) => item.tokenSHA256 === slotId);
    if (!slot) return;
    setCurrentToken(slot.token);
    navigate(path);
  }

  function openTrade(locator: ProTradeLocator) {
    const slot = slots.find((item) => item.tokenSHA256 === locator.slotId);
    if (!slot) {
      removeTrade(locator);
      setAnnouncement(`Order ${locator.orderId} was removed because its robot is no longer in the Garage`);
      return;
    }
    setCurrentToken(slot.token);
    navigate(`/order/${locator.shortAlias}/${locator.orderId}`);
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, view: ProView) {
    let next: ProView | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = view === "trades" ? "robots" : "trades";
    if (event.key === "Home") next = "trades";
    if (event.key === "End") next = "robots";
    if (!next) return;
    event.preventDefault();
    selectView(next);
    (next === "trades" ? tradesTab : robotsTab).current?.focus();
  }

  async function refresh() {
    setAnnouncement("Refreshing trade desk");
    await garageReconciler.reconcileAll("manual");
    setAnnouncement("Trade desk refreshed");
  }

  return (
    <main className="page page-wide pro-workspace-page">
      <header className="pro-workspace-header">
        <div>
          <p className="app-eyebrow">PRO</p>
          <h2>Trade desk</h2>
        </div>
        <div className="pro-workspace-commands">
          <Button
            aria-label="Refresh trade desk"
            disabled={refreshing || !hydrated}
            loading={refreshing}
            onClick={() => void refresh()}
            size="icon"
            title="Refresh"
            variant="outline"
          >
            <RefreshCw size={17} />
          </Button>
          <Button className="pro-add-robot-button" onClick={() => navigate("/garage?add=1")}>
            <Bot size={17} /> <span>Add robot</span>
          </Button>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">{announcement}</p>

      <section className="pro-summary-strip" aria-label="Trade summary">
        {summaryItems.map((item) => {
          const Icon = item.icon;
          const selected = filter === item.key && lastView === "trades";
          const stale = summaryHasStale(trades, item.key);
          return (
            <button
              className={selected ? "pro-summary-item active" : "pro-summary-item"}
              key={item.key}
              type="button"
              aria-pressed={selected}
              onClick={() => selectSummaryFilter(item.key)}
            >
              <Icon size={17} aria-hidden="true" />
              <strong>{counts[item.key]}</strong>
              <span>{item.label}{stale ? <small>Stale</small> : null}</span>
            </button>
          );
        })}
      </section>

      <section className="pro-workspace-surface">
        <header className="pro-workspace-toolbar">
          <div className="pro-view-tabs" role="tablist" aria-label="Trade desk view">
            <button
              id="pro-trades-tab"
              ref={tradesTab}
              type="button"
              role="tab"
              aria-selected={lastView === "trades"}
              aria-controls="pro-workspace-content"
              tabIndex={lastView === "trades" ? 0 : -1}
              onKeyDown={(event) => moveTab(event, "trades")}
              onClick={() => selectView("trades")}
            >
              Trades
            </button>
            <button
              id="pro-robots-tab"
              ref={robotsTab}
              type="button"
              role="tab"
              aria-selected={lastView === "robots"}
              aria-controls="pro-workspace-content"
              tabIndex={lastView === "robots" ? 0 : -1}
              onKeyDown={(event) => moveTab(event, "robots")}
              onClick={() => selectView("robots")}
            >
              Robots
            </button>
          </div>
          {robotFilter ? (
            <button className="pro-filter-clear" type="button" onClick={() => setRobotFilter(undefined)}>
              All robots
            </button>
          ) : null}
        </header>

        {failedRobotNames.length > 0 ? (
          <div className="pro-refresh-warning" role="status">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>
              <strong>{failedRobotNames.length === 1
                ? `Could not refresh ${failedRobotNames[0]}`
                : `Could not refresh ${failedRobotNames.length} robots`}</strong>
              <small>Last known trade states are preserved.</small>
            </span>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>Retry</Button>
          </div>
        ) : null}

        <div
          id="pro-workspace-content"
          className="pro-workspace-content"
          role="tabpanel"
          aria-labelledby={lastView === "trades" ? "pro-trades-tab" : "pro-robots-tab"}
          aria-busy={refreshing}
        >
          {lastView === "trades" ? (
            <TradeList
              coordinators={coordinators}
              onOpen={openTrade}
              snapshots={filteredTrades}
            />
          ) : (
            <RobotList
              onBrowse={(slotId) => useRobot(slotId, "/offers")}
              onCreate={(slotId) => useRobot(slotId, "/create")}
              onFilter={selectRobot}
              onUse={(slotId) => useRobot(slotId, "/garage")}
              slots={slots}
              summaries={robotSummaries}
              syncBySlot={syncBySlot}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function TradeList({
  coordinators,
  onOpen,
  snapshots
}: {
  coordinators: ReturnType<typeof useFederationStore.getState>["coordinators"];
  onOpen: (locator: ProTradeLocator) => void;
  snapshots: ProTradeSnapshot[];
}) {
  if (snapshots.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No matching trades"
        body="Active trades and public offers for every robot will appear here."
      />
    );
  }

  return (
    <div className="pro-trade-list" aria-label="Trades">
      <div className="pro-trade-header" aria-hidden="true">
        <span>Robot</span>
        <span>Order</span>
        <span>Coordinator</span>
        <span>Status</span>
        <span>Deadline</span>
        <span className="sr-only">Open</span>
      </div>
      {snapshots.map((snapshot, index) => {
        const presentation = toProTradePresentation(snapshot);
        const StatusIcon = presentation.statusIcon;
        const coordinator = coordinators.find((item) => item.shortAlias === snapshot.locator.shortAlias);
        const previous = snapshots[index - 1];
        const showGroup = !previous || toProTradePresentation(previous).group !== presentation.group;
        return (
          <Fragment key={snapshot.key}>
            {showGroup ? <div className="pro-trade-group">{groupLabel(presentation.group)}</div> : null}
            <button
              className="pro-trade-row"
              type="button"
              aria-label={`Open order ${snapshot.locator.orderId} for ${snapshot.nickname}`}
              onClick={() => onOpen(snapshot.locator)}
            >
              <span className="pro-trade-robot">
                <RobotAvatar hashId={snapshot.hashId} label={snapshot.nickname} size="sm" />
                <span><strong>{snapshot.nickname}</strong><small>{presentation.directionLabel}</small></span>
              </span>
              <span className="pro-trade-order">
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
              <span className="pro-trade-open" aria-hidden="true">
                <ChevronRight size={18} />
              </span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

function RobotList({
  onBrowse,
  onCreate,
  onFilter,
  onUse,
  slots,
  summaries,
  syncBySlot
}: {
  onBrowse: (slotId: string) => void;
  onCreate: (slotId: string) => void;
  onFilter: (slotId: string) => void;
  onUse: (slotId: string) => void;
  slots: ReturnType<typeof useGarageStore.getState>["slots"];
  summaries: ReturnType<typeof summarizeProRobots>;
  syncBySlot: ReturnType<typeof useProTradeIndexStore.getState>["syncBySlot"];
}) {
  if (slots.length === 0) {
    return <EmptyState icon={Bot} title="No robots in this Garage" body="Create or recover a robot from the normal Garage." />;
  }

  return (
    <div className="pro-robot-list">
      {summaries.map((summary) => {
        const slot = slots.find((item) => item.tokenSHA256 === summary.slotId);
        const sync = syncBySlot[summary.slotId];
        if (!slot) return null;
        return (
          <article className="pro-robot-row" key={summary.slotId}>
            <div className="pro-robot-identity">
              <RobotAvatar hashId={summary.hashId} label={summary.nickname} size="md" />
              <span>
                <strong>{summary.nickname}</strong>
                <small>{summary.coordinatorCount} known coordinator{summary.coordinatorCount === 1 ? "" : "s"}</small>
              </span>
            </div>
            <dl className="pro-robot-metrics">
              <button type="button" onClick={() => onFilter(summary.slotId)}>
                <dt>Active</dt><dd>{summary.activeTradeCount}</dd>
              </button>
              <div><dt>Public</dt><dd>{summary.publicOfferCount}</dd></div>
              <div><dt>Attention</dt><dd>{summary.needsAttentionCount}</dd></div>
            </dl>
            <div className="pro-robot-state">
              <Badge tone={summary.stale ? "muted" : summary.needsAttentionCount ? "warning" : "success"}>
                {summary.stale ? "Stale" : summary.needsAttentionCount ? "Needs attention" : "Ready"}
              </Badge>
              <small>{formatLastRefresh(sync?.lastSuccessAt)}</small>
            </div>
            <div className="pro-robot-actions">
              <Button size="sm" variant="ghost" onClick={() => onBrowse(summary.slotId)}>Offers</Button>
              <Button size="sm" variant="ghost" onClick={() => onCreate(summary.slotId)}>Create</Button>
              <Button size="sm" variant="secondary" onClick={() => onUse(summary.slotId)}>Use robot <ArrowRight size={15} /></Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof Bot; title: string; body: string }) {
  const navigate = useNavigate();
  const noRobots = title.includes("No robots");
  return (
    <div className="pro-empty-state">
      <Icon size={22} aria-hidden="true" />
      <div><strong>{title}</strong><p>{body}</p></div>
      <div>
        <Button size="sm" variant="secondary" onClick={() => navigate(noRobots ? "/garage?add=1" : "/offers")}>
          {noRobots ? "Add robot" : "Browse offers"}
        </Button>
        {!noRobots ? <Button size="sm" variant="ghost" onClick={() => navigate("/create")}>Create offer</Button> : null}
      </div>
    </div>
  );
}

function summaryCounts(trades: ProTradeSnapshot[]): Record<Exclude<ProFilter, "all">, number> {
  return {
    "needs-action": trades.filter((trade) => classifyProTrade(trade) === "needs-action").length,
    active: trades.filter((trade) => isActiveTrade(trade)).length,
    public: trades.filter((trade) => trade.order?.status === 1 && trade.order.is_maker).length,
    renewable: trades.filter((trade) => trade.renewable).length
  };
}

function summaryHasStale(trades: ProTradeSnapshot[], filter: Exclude<ProFilter, "all">): boolean {
  return trades.some((trade) => {
    if (trade.freshness !== "error" && trade.freshness !== "stale") return false;
    if (filter === "needs-action") return classifyProTrade({ ...trade, freshness: "fresh" }) === "needs-action";
    if (filter === "active") return isActiveTrade(trade);
    if (filter === "public") return trade.order?.status === 1 && trade.order.is_maker;
    return trade.renewable;
  });
}

function matchesFilter(snapshot: ProTradeSnapshot, filter: ProFilter, robotFilter?: string): boolean {
  if (robotFilter && snapshot.locator.slotId !== robotFilter) return false;
  if (filter === "all") return true;
  if (filter === "needs-action") return classifyProTrade(snapshot) === "needs-action";
  if (filter === "active") return isActiveTrade(snapshot);
  if (filter === "public") return snapshot.order?.status === 1 && snapshot.order.is_maker;
  return snapshot.renewable;
}

function groupLabel(group: ReturnType<typeof classifyProTrade>): string {
  if (group === "needs-action") return "Needs action";
  if (group === "in-progress") return "In progress";
  if (group === "waiting") return "Waiting and public";
  if (group === "renewable") return "Renewable";
  return "Refresh needed";
}

function isActiveTrade(snapshot: ProTradeSnapshot): boolean {
  const status = snapshot.order?.status;
  return status != null && status >= 3 && ![4, 5, 12, 14, 17, 18].includes(status);
}

function formatLastRefresh(value?: number): string {
  if (!value) return "Not refreshed";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (elapsedMinutes < 1) return "Updated now";
  if (elapsedMinutes < 60) return `Updated ${elapsedMinutes}m ago`;
  return `Updated ${Math.floor(elapsedMinutes / 60)}h ago`;
}
