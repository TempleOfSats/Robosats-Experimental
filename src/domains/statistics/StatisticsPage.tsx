import {
  Activity,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Download,
  Layers3,
  RefreshCw,
  TriangleAlert,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { VisualSelect } from "@/components/ui/visualSelect";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { currencyCodeFromId, orderCurrencyCodes } from "@/domains/orderbook/currencies";
import { orderSatsPreview } from "@/domains/orderbook/offerDisplay";
import { CurrencyFlag, PaymentMethodIcons } from "@/domains/orderbook/OfferMeta";
import { useOrderbookStore } from "@/domains/orderbook/orderbookStore";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { roleBuysBitcoin } from "@/domains/orders/orderRole";
import { fetchCompletedVolume, fetchMarketTicks } from "@/domains/statistics/statisticsApi";
import {
  activityVolumeSeries,
  completedVolumeSeries,
  marketActivityComparisons,
  tickCurrencyCode,
  tickFiatAmount,
  volumeWeightedPremium,
  type ActivityInterval,
  type ChartPoint,
  type CompletedInterval,
  type CompletedVolumeRecord,
  type MarketTick
} from "@/domains/statistics/statisticsModel";
import {
  liquidityDepth,
  liquidityMarkets,
  liquidityTotal,
  weightedLiquidityPremium,
  type LiquidityDepthPoint,
  type LiquidityEntry
} from "@/domains/statistics/liquidityModel";

type StatisticsView = "completed" | "activity" | "liquidity";
type LiquidityRange = 5 | 10 | 25 | "all";
type LoadState = {
  errors: Record<string, string>;
  pending: string[];
  responded: string[];
};
type LiquidityOrderEntry = LiquidityEntry & {
  coordinator?: CoordinatorSummary;
  order: PublicOrder;
};

const ACTIVITY_DAYS = 30;
const ACTIVITY_PAGE_SIZE = 15;

export function StatisticsPage() {
  const navigate = useNavigate();
  const coordinators = useFederationStore((state) => state.coordinators);
  const connection = useFederationStore((state) => state.connection);
  const network = useFederationStore((state) => state.network);
  const origin = useFederationStore((state) => state.origin);
  const orderbookOrders = useOrderbookStore((state) => state.orders);
  const orderbookLoading = useOrderbookStore((state) => state.loading);
  const orderbookRefreshing = useOrderbookStore((state) => state.refreshing);
  const orderbookError = useOrderbookStore((state) => state.error);
  const refreshOrderbook = useOrderbookStore((state) => state.refreshOrderbook);
  const targets = useMemo(
    () => coordinators.filter((coordinator) => coordinator.enabled && coordinator.shortAlias !== "local" && coordinator.url),
    [coordinators]
  );
  const targetKey = targets.map((coordinator) => `${coordinator.shortAlias}:${coordinator.url}`).join("|");
  const [view, setView] = useState<StatisticsView>("liquidity");
  const [completedInterval, setCompletedInterval] = useState<CompletedInterval>("day");
  const [activityInterval, setActivityInterval] = useState<ActivityInterval>("day");
  const [currency, setCurrency] = useState("all");
  const [liquidityCurrency, setLiquidityCurrency] = useState("all");
  const [liquidityRange, setLiquidityRange] = useState<LiquidityRange>(10);
  const [completedRecords, setCompletedRecords] = useState<CompletedVolumeRecord[]>([]);
  const [ticks, setTicks] = useState<MarketTick[]>([]);
  const [completedLoad, setCompletedLoad] = useState<LoadState>(emptyLoadState);
  const [activityLoad, setActivityLoad] = useState<LoadState>(emptyLoadState);
  const [completedRequested, setCompletedRequested] = useState(false);
  const [activityRequested, setActivityRequested] = useState(false);
  const [activityPage, setActivityPage] = useState(1);
  const completedGeneration = useRef(0);
  const activityGeneration = useRef(0);
  const tickRange = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - ACTIVITY_DAYS);
    return { end, start };
  }, []);

  const loadCompleted = useCallback(async (force = false) => {
    const generation = ++completedGeneration.current;
    setCompletedRequested(true);
    setCompletedLoad({ errors: {}, pending: targets.map((item) => item.shortAlias), responded: [] });
    if (force) setCompletedRecords([]);

    await Promise.allSettled(targets.map(async (coordinator) => {
      try {
        const records = await fetchCompletedVolume(coordinator, force);
        if (generation !== completedGeneration.current) return;
        setCompletedRecords((current) => [
          ...current.filter((record) => record.coordinator !== coordinator.shortAlias),
          ...records
        ]);
        setCompletedLoad((current) => settleCoordinator(current, coordinator.shortAlias));
      } catch (error) {
        if (generation !== completedGeneration.current) return;
        setCompletedLoad((current) => settleCoordinator(current, coordinator.shortAlias, error));
      }
    }));
  }, [targetKey]);

  const loadActivity = useCallback(async (force = false) => {
    const generation = ++activityGeneration.current;
    setActivityRequested(true);
    setActivityLoad({ errors: {}, pending: targets.map((item) => item.shortAlias), responded: [] });
    if (force) setTicks([]);

    await Promise.allSettled(targets.map(async (coordinator) => {
      try {
        const records = await fetchMarketTicks(coordinator, tickRange.start, tickRange.end, force);
        if (generation !== activityGeneration.current) return;
        setTicks((current) => [
          ...current.filter((tick) => tick.coordinator !== coordinator.shortAlias),
          ...records
        ].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)));
        setActivityLoad((current) => settleCoordinator(current, coordinator.shortAlias));
      } catch (error) {
        if (generation !== activityGeneration.current) return;
        setActivityLoad((current) => settleCoordinator(current, coordinator.shortAlias, error));
      }
    }));
  }, [targetKey, tickRange]);

  useEffect(() => {
    setCompletedRecords([]);
    setTicks([]);
    setCompletedRequested(false);
    setCompletedLoad(emptyLoadState());
    setActivityRequested(false);
    setActivityLoad(emptyLoadState());
  }, [targetKey]);

  useEffect(() => {
    if (view === "completed" && !completedRequested) void loadCompleted();
  }, [completedRequested, loadCompleted, view]);

  useEffect(() => {
    if (view === "activity" && !activityRequested) void loadActivity();
  }, [activityRequested, loadActivity, view]);

  const loadLiquidity = useCallback((force = false) => refreshOrderbook(coordinators, {
    connection,
    force,
    ...(connection === "nostr" ? { hostUrl: currentHostUrl() } : {}),
    network,
    origin
  }), [connection, coordinators, network, origin, refreshOrderbook]);

  useEffect(() => {
    if (view === "liquidity") void loadLiquidity();
  }, [loadLiquidity, view]);

  const completedSeries = useMemo(
    () => completedVolumeSeries(completedRecords, completedInterval),
    [completedInterval, completedRecords]
  );
  const currencyOptions = useMemo(() => [
    { value: "all", label: "All markets" },
    ...orderCurrencyCodes(ticks.map(tickCurrencyCode).filter((code) => code !== "Unknown" && !code.startsWith("#")))
      .map((code) => ({
        value: code,
        label: code,
        icon: <CurrencyFlag code={code} size={20} />
      }))
  ], [ticks]);
  const filteredTicks = useMemo(
    () => currency === "all" ? ticks : ticks.filter((tick) => tickCurrencyCode(tick) === currency),
    [currency, ticks]
  );
  const activitySeries = useMemo(
    () => activityVolumeSeries(filteredTicks, activityInterval),
    [activityInterval, filteredTicks]
  );
  const coordinatorByAlias = useMemo(
    () => new Map(coordinators.map((coordinator) => [coordinator.shortAlias, coordinator])),
    [coordinators]
  );
  const liquidityEntries = useMemo(() => orderbookOrders.flatMap((order): LiquidityOrderEntry[] => {
    const currencyCode = order.currencyCode ?? currencyCodeFromId(order.currency);
    const coordinator = coordinatorByAlias.get(order.coordinatorShortAlias);
    const preview = orderSatsPreview(order, coordinator?.limits);
    if (!currencyCode || !preview || preview.sats <= 0 || !Number.isFinite(order.premium)) return [];
    return [{
      currency: currencyCode,
      premium: order.premium,
      side: roleBuysBitcoin(order.type, "taker") ? "buy" : "sell",
      volumeBtc: preview.sats / 100_000_000,
      coordinator,
      order
    }];
  }), [coordinatorByAlias, orderbookOrders]);
  const liquidityCurrencyOptions = useMemo(() => marketCurrencyOptions(liquidityEntries.map((entry) => entry.currency)), [liquidityEntries]);
  const filteredLiquidity = useMemo(
    () => liquidityCurrency === "all" ? liquidityEntries : liquidityEntries.filter((entry) => entry.currency === liquidityCurrency),
    [liquidityCurrency, liquidityEntries]
  );
  const pageCount = Math.max(1, Math.ceil(filteredTicks.length / ACTIVITY_PAGE_SIZE));
  const visibleTicks = filteredTicks.slice((activityPage - 1) * ACTIVITY_PAGE_SIZE, activityPage * ACTIVITY_PAGE_SIZE);

  useEffect(() => {
    setActivityPage(1);
  }, [currency]);

  const statisticsRefreshing = view === "liquidity"
    ? orderbookLoading || orderbookRefreshing
    : activeLoad(view, completedLoad, activityLoad).pending.length > 0;

  return (
    <main className="page page-wide statistics-page">
      <div className="page-heading statistics-heading">
        <div>
          <p className="app-eyebrow">Federation</p>
          <h2>Market statistics</h2>
        </div>
        <div className="page-actions">
          <Button onClick={() => navigate("/offers")} size="sm" type="button" variant="ghost">
            <ArrowLeft size={16} /> Public offers
          </Button>
          <Button
            aria-label="Refresh statistics"
            loading={statisticsRefreshing}
            loadingLabel="Refreshing statistics"
            onClick={() => void (view === "completed" ? loadCompleted(true) : view === "activity" ? loadActivity(true) : loadLiquidity(true))}
            size="icon"
            title="Refresh statistics"
            type="button"
            variant="outline"
          >
            {!statisticsRefreshing ? <RefreshCw size={17} /> : null}
          </Button>
        </div>
      </div>

      <Tabs
        ariaLabel="Statistics dataset"
        className="statistics-tabs"
        id="statistics-view"
        onChange={setView}
        options={[
          { value: "liquidity", ariaLabel: "Live liquidity", label: <><Layers3 size={17} /><span className="statistics-tab-label-full">Live liquidity</span><span className="statistics-tab-label-compact">Liquidity</span></> },
          { value: "completed", ariaLabel: "Completed volume", label: <><CheckCircle2 size={17} /><span className="statistics-tab-label-full">Completed volume</span><span className="statistics-tab-label-compact">Completed</span></> },
          { value: "activity", ariaLabel: "Market activity", label: <><Activity size={17} /><span className="statistics-tab-label-full">Market activity</span><span className="statistics-tab-label-compact">Activity</span></> }
        ]}
        panelId="statistics-content"
        value={view}
      />

      <section aria-labelledby={`statistics-view-tab-${view}`} id="statistics-content" role="tabpanel">
        {view === "completed" ? (
          <CompletedPanel
            interval={completedInterval}
            load={completedLoad}
            onIntervalChange={setCompletedInterval}
            records={completedRecords}
            series={completedSeries}
            targets={targets}
          />
        ) : view === "activity" ? (
          <ActivityPanel
            coordinatorByAlias={coordinatorByAlias}
            currency={currency}
            currencyOptions={currencyOptions}
            interval={activityInterval}
            load={activityLoad}
            onCurrencyChange={setCurrency}
            onExport={() => exportTicks(filteredTicks, coordinatorByAlias)}
            onIntervalChange={setActivityInterval}
            onPageChange={setActivityPage}
            page={activityPage}
            pageCount={pageCount}
            series={activitySeries}
            targets={targets}
            ticks={visibleTicks}
            allTicks={filteredTicks}
            totalTicks={filteredTicks.length}
          />
        ) : (
          <LiquidityPanel
            currency={liquidityCurrency}
            currencyOptions={liquidityCurrencyOptions}
            entries={filteredLiquidity}
            error={orderbookError}
            loading={orderbookLoading && liquidityEntries.length === 0}
            markets={liquidityMarkets(liquidityEntries)}
            onCurrencyChange={setLiquidityCurrency}
            onRangeChange={setLiquidityRange}
            onSelectOrder={(order) => navigate("/offers", { state: { directOfferLaunch: { reviewOrder: order } } })}
            range={liquidityRange}
            refreshing={orderbookRefreshing}
          />
        )}
      </section>
    </main>
  );
}

function CompletedPanel({
  interval,
  load,
  onIntervalChange,
  records,
  series,
  targets
}: {
  interval: CompletedInterval;
  load: LoadState;
  onIntervalChange: (interval: CompletedInterval) => void;
  records: CompletedVolumeRecord[];
  series: ChartPoint[];
  targets: CoordinatorSummary[];
}) {
  const initialLoading = load.pending.length > 0 && records.length === 0;
  const periodVolume = sum(series.map((point) => point.volumeBtc));
  const periodTrades = sum(series.map((point) => point.contracts));
  const lifetimeVolume = sum(records.map((record) => record.volumeBtc));
  return (
    <div className="statistics-stack">
      <CoverageStatus load={load} targets={targets} />
      <div className="statistics-metrics" aria-label="Completed volume summary">
        <Metric label="Visible period" value={initialLoading ? "—" : `${formatBtc(periodVolume)} BTC`} />
        <Metric label="Successful trades" value={initialLoading ? "—" : periodTrades.toLocaleString()} />
        <Metric label="Reported lifetime" value={initialLoading ? "—" : `${formatBtc(lifetimeVolume)} BTC`} />
      </div>
      <Card className="statistics-chart-card">
        <CardHeader className="statistics-card-header">
          <div>
            <CardTitle>Completed BTC volume</CardTitle>
            <p>Successful trades reported by responding coordinators.</p>
          </div>
          <IntervalPicker<CompletedInterval>
            ariaLabel="Completed volume interval"
            onChange={onIntervalChange}
            options={[
              ["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]
            ]}
            value={interval}
          />
        </CardHeader>
        <CardContent>
          <VolumeBars
            emptyLabel="No completed volume was reported in this period."
            loading={initialLoading}
            loadingLabel="Loading completed trade history..."
            points={series}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ActivityPanel({
  allTicks,
  coordinatorByAlias,
  currency,
  currencyOptions,
  interval,
  load,
  onCurrencyChange,
  onExport,
  onIntervalChange,
  onPageChange,
  page,
  pageCount,
  series,
  targets,
  ticks,
  totalTicks
}: {
  allTicks: MarketTick[];
  coordinatorByAlias: Map<string, CoordinatorSummary>;
  currency: string;
  currencyOptions: Array<{ value: string; label: string; icon?: ReactNode }>;
  interval: ActivityInterval;
  load: LoadState;
  onCurrencyChange: (currency: string) => void;
  onExport: () => void;
  onIntervalChange: (interval: ActivityInterval) => void;
  onPageChange: (page: number) => void;
  page: number;
  pageCount: number;
  series: ChartPoint[];
  targets: CoordinatorSummary[];
  ticks: MarketTick[];
  totalTicks: number;
}) {
  const initialLoading = load.pending.length > 0 && totalTicks === 0;
  const volume = sum(series.map((point) => point.volumeBtc));
  const averagePremium = volumeWeightedPremium(allTicks);
  const comparisons = marketActivityComparisons(allTicks);
  return (
    <div className="statistics-stack">
      <CoverageStatus load={load} targets={targets} />
      <div className="statistics-metrics" aria-label="Market activity summary">
        <Metric label="Activity records" value={initialLoading ? "—" : totalTicks.toLocaleString()} />
        <Metric label="Visible volume" value={initialLoading ? "—" : `${formatBtc(volume)} BTC`} />
        <Metric label="Average premium" value={initialLoading ? "—" : formatPremium(averagePremium)} />
      </div>
      <Card className="statistics-chart-card">
        <CardHeader className="statistics-card-header statistics-activity-toolbar">
          <div>
            <CardTitle>Public orderbook activity</CardTitle>
            <p>Trades recorded after appearing as public offers in the orderbook. They may later have completed, been cancelled or expired; this is activity, not completed-trade volume.</p>
          </div>
          <div className="statistics-chart-controls">
            <VisualSelect
              ariaLabel="Filter market activity by currency"
              className="statistics-currency-select"
              onChange={onCurrencyChange}
              options={currencyOptions}
              value={currency}
            />
            <IntervalPicker<ActivityInterval>
              ariaLabel="Market activity interval"
              onChange={onIntervalChange}
              options={[["ten-minutes", "10 min"], ["hour", "Hour"], ["day", "Day"]]}
              value={interval}
            />
          </div>
        </CardHeader>
        <CardContent>
          <VolumeBars
            emptyLabel="No market activity was reported for this selection."
            loading={initialLoading}
            loadingLabel="Loading recent market activity..."
            points={series}
          />
        </CardContent>
      </Card>

      <MarketComparisonCard comparisons={comparisons} loading={initialLoading} />

      <Card className="statistics-table-card">
        <CardHeader className="statistics-card-header">
          <div>
            <CardTitle>Recent market activity</CardTitle>
            <p>Public orderbook records from the last {ACTIVITY_DAYS} days. Their final outcomes are not known here.</p>
          </div>
          <Button disabled={totalTicks === 0} onClick={onExport} size="sm" type="button" variant="outline">
            <Download size={16} /> Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <ActivityTable coordinatorByAlias={coordinatorByAlias} loading={initialLoading} ticks={ticks} />
          {pageCount > 1 ? (
            <div className="statistics-pagination" aria-label="Market activity pages">
              <Button disabled={page <= 1} onClick={() => onPageChange(page - 1)} size="sm" type="button" variant="ghost">Previous</Button>
              <span>Page {page} of {pageCount}</span>
              <Button disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} size="sm" type="button" variant="outline">Next</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function MarketComparisonCard({
  comparisons,
  loading
}: {
  comparisons: ReturnType<typeof marketActivityComparisons>;
  loading: boolean;
}) {
  const visible = comparisons.slice(0, 10);
  const maximum = Math.max(0, ...visible.map((market) => market.volumeBtc));
  return (
    <Card className="statistics-comparison-card">
      <CardHeader className="statistics-card-header">
        <div>
          <CardTitle>Activity by market</CardTitle>
          <p>Reported BTC volume and volume-weighted average premium over the last {ACTIVITY_DAYS} days.</p>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="statistics-table-empty" role="status"><span className="ui-spinner" aria-hidden="true" /><strong>Comparing markets</strong></div>
        ) : visible.length === 0 ? (
          <div className="statistics-table-empty"><BarChart3 size={22} /><strong>No comparable markets</strong><span>Volume-bearing activity will appear here.</span></div>
        ) : (
          <div className="statistics-market-comparison" role="list" aria-label="Market activity comparison">
            {visible.map((market) => (
              <div className="statistics-market-row" role="listitem" key={market.currency}>
                <span className="statistics-market-label"><CurrencyFlag code={market.currency} size={19} /><strong>{market.currency}</strong></span>
                <span className="statistics-market-track" aria-hidden="true">
                  <span style={{ "--statistics-market-width": `${maximum > 0 ? (market.volumeBtc / maximum) * 100 : 0}%` } as CSSProperties} />
                </span>
                <span className="statistics-market-value tabular"><strong>{formatBtc(market.volumeBtc)} BTC</strong><small>{formatPremium(market.averagePremium)} avg · {market.activity.toLocaleString()} records</small></span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LiquidityPanel({
  currency,
  currencyOptions,
  entries,
  error,
  loading,
  markets,
  onCurrencyChange,
  onRangeChange,
  onSelectOrder,
  range,
  refreshing
}: {
  currency: string;
  currencyOptions: Array<{ value: string; label: string; icon?: ReactNode }>;
  entries: LiquidityOrderEntry[];
  error?: string;
  loading: boolean;
  markets: ReturnType<typeof liquidityMarkets>;
  onCurrencyChange: (currency: string) => void;
  onRangeChange: (range: LiquidityRange) => void;
  onSelectOrder: (order: PublicOrder) => void;
  range: LiquidityRange;
  refreshing: boolean;
}) {
  const [selectedPremium, setSelectedPremium] = useState<number>();
  const buyBtc = liquidityTotal(entries, "buy");
  const sellBtc = liquidityTotal(entries, "sell");
  const depth = liquidityDepth(entries, range === "all" ? undefined : range);
  const averagePremium = weightedLiquidityPremium(entries);
  const selectedEntries = selectedPremium === undefined
    ? []
    : entries.filter((entry) => premiumsEqual(entry.premium, selectedPremium));
  return (
    <div className="statistics-stack">
      <div className={`statistics-live-status${error ? " statistics-live-status-error" : ""}`} role="status" aria-live="polite">
        <span className="statistics-live-dot" aria-hidden="true" />
        <span>{loading ? "Loading current public offers..." : error ? "Showing available cached liquidity" : "Current public orderbook liquidity"}</span>
        {refreshing && !loading ? <span className="statistics-live-refreshing"><span className="ui-spinner" aria-hidden="true" /> Updating</span> : null}
      </div>
      <div className="statistics-metrics" aria-label="Current liquidity summary">
        <Metric label="Public offers" value={loading ? "—" : entries.length.toLocaleString()} />
        <Metric label="Buy BTC liquidity" value={loading ? "—" : `${formatBtc(buyBtc)} BTC`} />
        <Metric label="Sell BTC liquidity" value={loading ? "—" : `${formatBtc(sellBtc)} BTC`} />
        <Metric label="Average premium" value={loading ? "—" : formatPremium(averagePremium)} />
      </div>
      <Card className="statistics-depth-card">
        <CardHeader className="statistics-card-header statistics-liquidity-toolbar">
          <div>
            <CardTitle>Liquidity by premium</CardTitle>
            <p>Cumulative BTC available to buy or sell across current public offers. Range orders use their current maximum estimate.</p>
          </div>
          <div className="statistics-chart-controls">
            <VisualSelect
              ariaLabel="Filter current liquidity by currency"
              className="statistics-currency-select"
              onChange={onCurrencyChange}
              options={currencyOptions}
              value={currency}
            />
            <IntervalPicker<LiquidityRange>
              ariaLabel="Premium chart range"
              onChange={onRangeChange}
              options={[[5, "±5%"], [10, "±10%"], [25, "±25%"], ["all", "All"]]}
              value={range}
            />
          </div>
        </CardHeader>
        <CardContent>
          <LiquidityDepthChart
            entries={entries}
            loading={loading}
            onSelectPremium={setSelectedPremium}
            points={depth}
          />
        </CardContent>
      </Card>
      <LiquidityMarkets markets={markets} selectedCurrency={currency} />
      {selectedPremium !== undefined && selectedEntries.length > 0 ? (
        <LiquidityOrdersDialog
          entries={selectedEntries}
          onClose={() => setSelectedPremium(undefined)}
          onSelectOrder={(order) => {
            setSelectedPremium(undefined);
            onSelectOrder(order);
          }}
          premium={selectedPremium}
        />
      ) : null}
    </div>
  );
}

function LiquidityDepthChart({
  entries,
  loading,
  onSelectPremium,
  points
}: {
  entries: LiquidityOrderEntry[];
  loading: boolean;
  onSelectPremium: (premium: number) => void;
  points: LiquidityDepthPoint[];
}) {
  const [hovered, setHovered] = useState<number>();
  const width = 800;
  const height = 320;
  const plot = { bottom: 274, left: 62, right: 782, top: 18 };
  const minimumPremium = points[0]?.premium ?? -10;
  const maximumPremium = points.at(-1)?.premium ?? 10;
  const maximumBtc = Math.max(0, ...points.flatMap((point) => [point.buyBtc, point.sellBtc]));
  const x = (premium: number) => plot.left + ((premium - minimumPremium) / Math.max(1, maximumPremium - minimumPremium)) * (plot.right - plot.left);
  const y = (btc: number) => plot.bottom - (btc / Math.max(maximumBtc, 0.00000001)) * (plot.bottom - plot.top);
  const buyPath = stepPath(points, (point) => x(point.premium), (point) => y(point.buyBtc));
  const sellPath = stepPath(points, (point) => x(point.premium), (point) => y(point.sellBtc));
  const selectablePoints = points.flatMap((point, index) => {
    const orderCount = entries.filter((entry) => premiumsEqual(entry.premium, point.premium)).length;
    return orderCount > 0 ? [{ index, orderCount, point }] : [];
  });
  const closestPointIndex = (element: SVGSVGElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    const pointerX = ((clientX - bounds.left) / bounds.width) * width;
    const candidates = selectablePoints.length > 0 ? selectablePoints.map((item) => item.index) : points.map((_, index) => index);
    let closest = candidates[0] ?? 0;
    for (const index of candidates.slice(1)) {
      if (Math.abs(x(points[index].premium) - pointerX) < Math.abs(x(points[closest].premium) - pointerX)) closest = index;
    }
    return closest;
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    setHovered(closestPointIndex(event.currentTarget, event.clientX));
  };
  const focusPoint = hovered === undefined ? undefined : points[hovered];
  const focusOrderCount = focusPoint
    ? entries.filter((entry) => premiumsEqual(entry.premium, focusPoint.premium)).length
    : 0;
  const xTicks = Array.from({ length: 5 }, (_, index) => minimumPremium + ((maximumPremium - minimumPremium) * index) / 4);
  const yTicks = Array.from({ length: 5 }, (_, index) => (maximumBtc * index) / 4);

  if (loading) return <div className="statistics-depth-empty" role="status"><span className="ui-spinner" aria-hidden="true" /><strong>Loading live liquidity</strong><span>Reading current offers from the orderbook...</span></div>;
  if (points.length === 0) return <div className="statistics-depth-empty"><Layers3 size={24} /><strong>No liquidity in this range</strong><span>Choose another market or widen the premium range.</span></div>;

  return (
    <div className="statistics-depth-chart">
      <div className="statistics-depth-legend" aria-hidden="true"><span className="buy">Buy BTC</span><span className="sell">Sell BTC</span></div>
      <svg
        aria-label="Cumulative buy and sell Bitcoin liquidity by premium"
        onPointerLeave={() => setHovered(undefined)}
        onPointerMove={pointerMove}
        role="group"
        viewBox={`0 0 ${width} ${height}`}
      >
        {yTicks.map((tick) => <g key={`y:${tick}`}><line className="statistics-depth-grid" x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} /><text className="statistics-depth-axis" textAnchor="end" x={plot.left - 10} y={y(tick) + 4}>{formatAxisBtc(tick)}</text></g>)}
        {xTicks.map((tick) => <g key={`x:${tick}`}><line className="statistics-depth-grid" x1={x(tick)} x2={x(tick)} y1={plot.top} y2={plot.bottom} /><text className="statistics-depth-axis" textAnchor="middle" x={x(tick)} y={plot.bottom + 22}>{formatCompactPremium(tick)}</text></g>)}
        <path className="statistics-depth-area statistics-depth-area-sell" d={`${sellPath} L ${x(points.at(-1)?.premium ?? 0)} ${plot.bottom} L ${x(points[0]?.premium ?? 0)} ${plot.bottom} Z`} />
        <path className="statistics-depth-area statistics-depth-area-buy" d={`${buyPath} L ${x(points.at(-1)?.premium ?? 0)} ${plot.bottom} L ${x(points[0]?.premium ?? 0)} ${plot.bottom} Z`} />
        <path className="statistics-depth-line statistics-depth-line-sell" d={sellPath} />
        <path className="statistics-depth-line statistics-depth-line-buy" d={buyPath} />
        <line className="statistics-depth-zero" x1={x(0)} x2={x(0)} y1={plot.top} y2={plot.bottom} />
        {selectablePoints.map(({ index, orderCount, point }, selectableIndex) => {
          const previous = selectablePoints[selectableIndex - 1]?.point;
          const next = selectablePoints[selectableIndex + 1]?.point;
          const left = previous ? (x(previous.premium) + x(point.premium)) / 2 : plot.left;
          const right = next ? (x(point.premium) + x(next.premium)) / 2 : plot.right;
          return (
            <rect
              aria-label={`${formatPremium(point.premium)} premium, ${orderCount} public offer${orderCount === 1 ? "" : "s"}. Open offers.`}
              className="statistics-depth-hit-target"
              height={plot.bottom - plot.top}
              key={`offer:${point.premium}`}
              onClick={(event) => {
                const chart = event.currentTarget.ownerSVGElement;
                const selectedPoint = chart ? points[closestPointIndex(chart, event.clientX)] : point;
                onSelectPremium(selectedPoint?.premium ?? point.premium);
              }}
              onFocus={() => setHovered(index)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelectPremium(point.premium);
              }}
              onPointerEnter={() => setHovered(index)}
              role="button"
              tabIndex={0}
              width={Math.max(1, right - left)}
              x={left}
              y={plot.top}
            />
          );
        })}
        {focusPoint ? (
          <DepthTooltip
            orderCount={focusOrderCount}
            point={focusPoint}
            x={x(focusPoint.premium)}
            y={Math.min(y(focusPoint.buyBtc), y(focusPoint.sellBtc))}
          />
        ) : null}
      </svg>
      <span className="statistics-depth-y-label">Cumulative BTC</span>
      <span className="statistics-depth-x-label">Premium</span>
    </div>
  );
}

function DepthTooltip({ orderCount, point, x, y }: { orderCount: number; point: LiquidityDepthPoint; x: number; y: number }) {
  const left = x > 610 ? x - 188 : x + 10;
  const top = Math.max(24, Math.min(180, y - 28));
  return (
    <g className="statistics-depth-tooltip">
      <line x1={x} x2={x} y1={18} y2={274} />
      <rect height={orderCount > 0 ? 94 : 76} rx="5" width="178" x={left} y={top} />
      <text className="statistics-depth-tooltip-title" x={left + 12} y={top + 21}>{formatPremium(point.premium)}</text>
      <text className="statistics-depth-tooltip-buy" x={left + 12} y={top + 43}>Buy {formatBtc(point.buyBtc)} BTC</text>
      <text className="statistics-depth-tooltip-sell" x={left + 12} y={top + 63}>Sell {formatBtc(point.sellBtc)} BTC</text>
      {orderCount > 0 ? <text className="statistics-depth-tooltip-action" x={left + 12} y={top + 83}>Review {orderCount} offer{orderCount === 1 ? "" : "s"}</text> : null}
    </g>
  );
}

function LiquidityOrdersDialog({
  entries,
  onClose,
  onSelectOrder,
  premium
}: {
  entries: LiquidityOrderEntry[];
  onClose: () => void;
  onSelectOrder: (order: PublicOrder) => void;
  premium: number;
}) {
  return (
    <Dialog
      ariaDescribedby="liquidity-orders-description"
      ariaLabelledby="liquidity-orders-title"
      dismissOnBackdrop
      onClose={onClose}
      overlayClassName="confirm-overlay statistics-liquidity-orders-overlay"
      panelClassName="confirm-sheet statistics-liquidity-orders-dialog"
    >
      <header className="statistics-liquidity-orders-header">
        <div>
          <p className="app-eyebrow">Live liquidity · {formatPremium(premium)}</p>
          <h3 id="liquidity-orders-title">Choose a public offer</h3>
          <p id="liquidity-orders-description">
            {entries.length} offer{entries.length === 1 ? "" : "s"} currently available at this premium.
          </p>
        </div>
        <Button aria-label="Close offers" onClick={onClose} size="icon" type="button" variant="ghost"><X size={18} /></Button>
      </header>
      <div className="statistics-liquidity-order-list">
        {entries.map((entry) => {
          const order = entry.order;
          return (
            <button
              className="statistics-liquidity-order"
              key={`${order.coordinatorShortAlias}:${order.id}`}
              onClick={() => onSelectOrder(order)}
              type="button"
            >
              <span className={`statistics-liquidity-order-side ${entry.side}`}>
                <small>{entry.side === "buy" ? "Buy" : "Sell"}</small>
                <strong>BTC</strong>
              </span>
              <span className="statistics-liquidity-order-main">
                <strong><CurrencyFlag code={entry.currency} size={18} /> {formatLiquidityOrderAmount(order, entry.currency)}</strong>
                <small><PaymentMethodIcons text={order.payment_method} size={18} /> <span>{order.payment_method}</span></small>
              </span>
              <span className="statistics-liquidity-order-source">
                {entry.coordinator ? <img alt="" src={entry.coordinator.smallAvatarUrl} /> : null}
                <span><strong>{entry.coordinator?.longAlias ?? order.coordinatorShortAlias}</strong><small>{order.maker_nick}</small></span>
              </span>
              <span className="statistics-liquidity-order-action">Review</span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

function LiquidityMarkets({ markets, selectedCurrency }: { markets: ReturnType<typeof liquidityMarkets>; selectedCurrency: string }) {
  const visible = (selectedCurrency === "all" ? markets : markets.filter((market) => market.currency === selectedCurrency)).slice(0, 10);
  const maximum = Math.max(0, ...visible.map((market) => market.buyBtc + market.sellBtc));
  return (
    <Card className="statistics-comparison-card">
      <CardHeader className="statistics-card-header"><div><CardTitle>Liquidity by market</CardTitle><p>Current public offer depth split by the taker action.</p></div></CardHeader>
      <CardContent>
        {visible.length === 0 ? <div className="statistics-table-empty"><Layers3 size={22} /><strong>No public liquidity</strong></div> : (
          <div className="statistics-liquidity-markets" role="list" aria-label="Current liquidity by market">
            {visible.map((market) => {
              const total = market.buyBtc + market.sellBtc;
              return <div className="statistics-liquidity-market" role="listitem" key={market.currency}>
                <span className="statistics-market-label"><CurrencyFlag code={market.currency} size={19} /><strong>{market.currency}</strong></span>
                <span className="statistics-liquidity-track" aria-hidden="true">
                  <span className="sell" style={{ "--statistics-market-width": `${maximum > 0 ? (market.sellBtc / maximum) * 100 : 0}%` } as CSSProperties} />
                  <span className="buy" style={{ "--statistics-market-width": `${maximum > 0 ? (market.buyBtc / maximum) * 100 : 0}%` } as CSSProperties} />
                </span>
                <span className="statistics-market-value tabular"><strong>{formatBtc(total)} BTC</strong><small>{market.offers} offer{market.offers === 1 ? "" : "s"}</small></span>
              </div>;
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CoverageStatus({ load, targets }: { load: LoadState; targets: CoordinatorSummary[] }) {
  const failed = Object.keys(load.errors).length;
  const complete = load.responded.length;
  const pending = load.pending.length;
  const tone = failed > 0 ? "partial" : pending > 0 ? "loading" : "complete";
  const label = targets.length === 0
    ? "No enabled coordinators are available."
    : pending > 0
      ? `Loading federation data · ${complete} of ${targets.length} coordinators responded`
      : failed > 0
        ? `Partial federation data · ${complete} of ${targets.length} coordinators responded`
        : `Combined from ${complete} coordinator${complete === 1 ? "" : "s"}`;
  return (
    <div className={`statistics-coverage statistics-coverage-${tone}`} role="status" aria-live="polite">
      <span className="statistics-coverage-icon" aria-hidden="true">
        {pending > 0 ? <span className="ui-spinner" /> : failed > 0 ? <TriangleAlert size={16} /> : <CheckCircle2 size={16} />}
      </span>
      <span>{label}</span>
      <span className="statistics-coverage-avatars" aria-hidden="true">
        {targets.map((coordinator) => (
          <img
            className={load.responded.includes(coordinator.shortAlias) ? "statistics-source-ready" : ""}
            key={coordinator.shortAlias}
            src={coordinator.smallAvatarUrl}
            alt=""
            title={coordinator.longAlias}
          />
        ))}
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="statistics-metric"><span>{label}</span><strong className="tabular">{value}</strong></div>;
}

function IntervalPicker<Value extends string | number>({
  ariaLabel,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  onChange: (value: Value) => void;
  options: Array<[Value, string]>;
  value: Value;
}) {
  return (
    <div className="statistics-interval" role="group" aria-label={ariaLabel}>
      {options.map(([option, label]) => (
        <button
          aria-pressed={value === option}
          className={value === option ? "active" : ""}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function VolumeBars({
  emptyLabel,
  loading = false,
  loadingLabel,
  points
}: {
  emptyLabel: string;
  loading?: boolean;
  loadingLabel: string;
  points: ChartPoint[];
}) {
  const maximum = Math.max(0, ...points.map((point) => point.volumeBtc));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  return (
    <div className="statistics-chart-shell">
      <div className="statistics-y-axis" aria-hidden="true">
        <span>{formatAxisBtc(maximum)}</span>
        <span>{formatAxisBtc(maximum / 2)}</span>
        <span>0</span>
      </div>
      <div
        aria-label={`BTC volume chart. ${points.length} periods shown.`}
        className="statistics-bars"
        role="list"
      >
        {points.map((point, index) => {
          const height = maximum > 0 ? Math.max(point.volumeBtc > 0 ? 2 : 0, (point.volumeBtc / maximum) * 100) : 0;
          const style = { "--statistics-bar-height": `${height}%` } as CSSProperties;
          return (
            <div
              aria-label={`${point.label}: ${formatBtc(point.volumeBtc)} BTC, ${point.contracts} records`}
              className="statistics-bar"
              key={point.key}
              role="listitem"
              style={style}
              tabIndex={point.volumeBtc > 0 ? 0 : -1}
            >
              <span className="statistics-bar-fill" />
              {(index % labelEvery === 0 || index === points.length - 1) ? (
                <small className={index === 0 || index === points.length - 1 ? "statistics-bar-label-edge" : ""}>{point.label}</small>
              ) : null}
              {point.volumeBtc > 0 ? (
                <span className="statistics-bar-tooltip">
                  <strong>{formatBtc(point.volumeBtc)} BTC</strong>
                  <small>{point.contracts.toLocaleString()} record{point.contracts === 1 ? "" : "s"} · {point.label}</small>
                </span>
              ) : null}
            </div>
          );
        })}
        {loading ? (
          <div className="statistics-chart-empty" role="status">
            <span className="ui-spinner" aria-hidden="true" />
            <span>{loadingLabel}</span>
          </div>
        ) : maximum === 0 ? (
          <div className="statistics-chart-empty"><BarChart3 size={24} /><span>{emptyLabel}</span></div>
        ) : null}
      </div>
    </div>
  );
}

function ActivityTable({
  coordinatorByAlias,
  loading,
  ticks
}: {
  coordinatorByAlias: Map<string, CoordinatorSummary>;
  loading: boolean;
  ticks: MarketTick[];
}) {
  if (loading) {
    return <div className="statistics-table-empty" role="status"><span className="ui-spinner" aria-hidden="true" /><strong>Loading activity</strong><span>Collecting recent records from coordinators...</span></div>;
  }
  if (ticks.length === 0) {
    return <div className="statistics-table-empty"><Activity size={22} /><strong>No activity records</strong><span>Try another market or refresh coordinator data.</span></div>;
  }
  return (
    <div className="statistics-table" role="table" aria-label="Recent market activity">
      <div className="statistics-table-header" role="row">
        <span role="columnheader">Date / time</span>
        <span role="columnheader">Market</span>
        <span role="columnheader">Price</span>
        <span role="columnheader">Amount in BTC</span>
        <span role="columnheader">Amount</span>
        <span role="columnheader">Premium</span>
        <span role="columnheader">Coordinator</span>
      </div>
      {ticks.map((tick, index) => {
        const code = tickCurrencyCode(tick);
        const fiat = tickFiatAmount(tick);
        const coordinator = coordinatorByAlias.get(tick.coordinator);
        return (
          <div className="statistics-table-row" role="row" key={`${tick.coordinator}:${tick.timestamp}:${index}`}>
            <span data-label="Date / time" role="cell">{formatTimestamp(tick.timestamp)}</span>
            <strong data-label="Market" role="cell">{code === "BTC" ? "BTC swap" : `BTC/${code}`}</strong>
            <span className="tabular" data-label="Price" role="cell">{formatNumber(tick.price)}</span>
            <span className="tabular" data-label="Amount in BTC" role="cell">{tick.volumeBtc === undefined ? "—" : formatBtc(tick.volumeBtc)}</span>
            <span className="tabular" data-label="Amount" role="cell">{fiat === undefined ? "—" : `${formatNumber(fiat, code === "BTC" ? 8 : 2)} ${code}`}</span>
            <span className="tabular" data-label="Premium" role="cell">{tick.premium === undefined ? "—" : `${tick.premium > 0 ? "+" : ""}${tick.premium.toFixed(2)}%`}</span>
            <span className="statistics-table-coordinator" data-label="Coordinator" role="cell">
              {coordinator ? <img src={coordinator.smallAvatarUrl} alt="" /> : null}
              <span>{coordinator?.longAlias ?? tick.coordinator}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function settleCoordinator(current: LoadState, alias: string, error?: unknown): LoadState {
  return {
    pending: current.pending.filter((item) => item !== alias),
    responded: error ? current.responded : [...new Set([...current.responded, alias])],
    errors: error
      ? { ...current.errors, [alias]: error instanceof Error ? error.message : "Coordinator unavailable" }
      : current.errors
  };
}

function emptyLoadState(): LoadState {
  return { errors: {}, pending: [], responded: [] };
}

function activeLoad(view: StatisticsView, completed: LoadState, activity: LoadState): LoadState {
  return view === "completed" ? completed : activity;
}

function exportTicks(ticks: MarketTick[], coordinatorByAlias: Map<string, CoordinatorSummary>) {
  const rows = [
    ["timestamp", "market", "price", "amount_btc", "amount", "premium_percent", "fee_btc", "coordinator"],
    ...ticks.map((tick) => {
      const code = tickCurrencyCode(tick);
      return [
        tick.timestamp,
        code === "BTC" ? "BTC swap" : `BTC/${code}`,
        tick.price ?? "",
        tick.volumeBtc ?? "",
        tickFiatAmount(tick) ?? "",
        tick.premium ?? "",
        tick.fee,
        coordinatorByAlias.get(tick.coordinator)?.longAlias ?? tick.coordinator
      ];
    })
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `robosats-market-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

function csvCell(value: unknown): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function formatBtc(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function formatAxisBtc(value: number): string {
  if (value === 0) return "0";
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatNumber(value?: number, maximumFractionDigits = 8): string {
  if (value === undefined) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatPremium(value?: number): string {
  if (value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatLiquidityOrderAmount(order: PublicOrder, currency: string): string {
  if (order.has_range) {
    return `${formatNumber(order.min_amount, 2)}–${formatNumber(order.max_amount, 2)} ${currency}`;
  }
  return `${formatNumber(order.amount ?? undefined, 2)} ${currency}`;
}

function premiumsEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

function formatCompactPremium(value: number): string {
  return `${value > 0 ? "+" : ""}${Number(value.toFixed(1))}%`;
}

function marketCurrencyOptions(codes: Iterable<string>): Array<{ value: string; label: string; icon?: ReactNode }> {
  return [
    { value: "all", label: "All markets" },
    ...orderCurrencyCodes(codes).map((code) => ({
      value: code,
      label: code,
      icon: <CurrencyFlag code={code} size={20} />
    }))
  ];
}

function stepPath(
  points: LiquidityDepthPoint[],
  x: (point: LiquidityDepthPoint) => number,
  y: (point: LiquidityDepthPoint) => number
): string {
  if (points.length === 0) return "";
  return points.slice(1).reduce(
    (path, point) => `${path} H ${x(point)} V ${y(point)}`,
    `M ${x(points[0])} ${y(points[0])}`
  );
}

function currentHostUrl(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.host || window.location.hostname;
}
