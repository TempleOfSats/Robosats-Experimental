import { useState } from "react";
import { Download, ExternalLink, Rocket, Star, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, tabId } from "@/components/ui/tabs";
import { currencyCodeFromId } from "@/domains/orderbook/currencies";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import type { OrderDto } from "@/domains/orders/order.types";
import { downloadTextFile } from "@/domains/transport/downloadFile";
import { formatFiat, formatSats } from "@/lib/format";
import { toUserMessage } from "@/lib/userError";

type CompletedTradePanelProps = {
  canSubmit: boolean;
  coordinatorName: string;
  loading: boolean;
  onPublishRating?: (rating: number) => Promise<void>;
  onStartAgain: () => void;
  order: OrderDto;
};

export function CompletedTradePanel({
  canSubmit,
  coordinatorName,
  loading,
  onPublishRating,
  onStartAgain,
  order
}: CompletedTradePanelProps) {
  const queued = Boolean(order.tx_queued && !order.txid);
  const tradeOverview = {
    format: "robosats-trade-overview",
    version: 1,
    order_id: order.id,
    status: order.status,
    coordinator: order.shortAlias,
    role: order.is_maker ? "maker" : "taker",
    side: order.is_buyer ? "buy" : "sell",
    amount: order.amount,
    currency: currencyCodeFromId(order.currency) ?? order.currency,
    payment_method: order.payment_method,
    premium_percent: order.premium,
    amount_sats: order.sent_satoshis || order.num_satoshis || order.trade_satoshis || order.invoice_amount,
    txid: order.txid,
    address: order.address,
    maker_summary: order.maker_summary,
    taker_summary: order.taker_summary,
    platform_summary: order.platform_summary
  };

  return (
    <Card className="trade-completion-card">
      <CardContent>
        <div className="trade-completion-hero">
          <h2>
            <Zap size={22} aria-hidden /> {queued ? "Payout accepted" : "Trade finished!"} <Zap size={22} aria-hidden />
          </h2>
          <p>
            {queued
              ? "The payout is queued and will be broadcast shortly."
              : "Thank you for trading privately with RoboSats."}
          </p>
        </div>

        {queued ? (
          <p className="trade-completion-note">This page will keep checking until the transaction is broadcast.</p>
        ) : null}
        <div className="trade-completion-actions">
          {order.txid ? (
            <Button
              variant="secondary"
              onClick={() => window.open(blockExplorerUrl(order.txid!, order.network), "_blank", "noopener,noreferrer")}
            >
              <ExternalLink size={15} /> View transaction
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => downloadJson(`robosats-trade-${order.id}-overview.json`, tradeOverview)}
          >
            <Download size={15} /> Download trade overview
          </Button>
        </div>
        {order.maker_summary || order.taker_summary || order.platform_summary ? (
          <details className="trade-completion-details">
            <summary>Receipt details</summary>
            <pre className="receipt-json">{JSON.stringify(tradeOverview, null, 2)}</pre>
          </details>
        ) : null}

        {!queued ? (
          <>
            <RatingSubmissionCard
              canSubmit={canSubmit}
              coordinatorName={coordinatorName}
              loading={loading}
              onPublishRating={onPublishRating}
            />
            <div className="trade-completion-restart">
              <p>RoboSats gets better with more liquidity. Tell a bitcoiner friend about it.</p>
              <Button variant="secondary" onClick={onStartAgain}>
                <Rocket size={16} /> Start again
              </Button>
            </div>
            <CompletedTradeSummary order={order} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function blockExplorerUrl(txid: string, network?: string): string {
  if (network === "testnet") return `https://mempool.space/testnet/tx/${txid}`;
  if (network === "signet") return `https://mempool.space/signet/tx/${txid}`;
  return `https://mempool.space/tx/${txid}`;
}

function downloadJson(filename: string, value: unknown) {
  downloadTextFile(filename, JSON.stringify(value, null, 2), "application/json");
}

function RatingSubmissionCard({
  canSubmit,
  coordinatorName,
  loading,
  onPublishRating
}: {
  canSubmit: boolean;
  coordinatorName: string;
  loading: boolean;
  onPublishRating?: (rating: number) => Promise<void>;
}) {
  const [peerRating, setPeerRating] = useState(0);
  const [coordinatorRating, setCoordinatorRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [localError, setLocalError] = useState("");

  async function selectCoordinatorRating(rating: number) {
    setCoordinatorRating(rating);
    setSubmitted(false);
    setLocalError("");
    if (!canSubmit) {
      setLocalError("Load this live order with your robot before rating the trade.");
      return;
    }
    if (!onPublishRating) {
      setLocalError("Coordinator rating is unavailable.");
      return;
    }
    setSubmitting(true);
    try {
      await onPublishRating(rating);
      setSubmitted(true);
    } catch (error) {
      setLocalError(toUserMessage(error, "Could not publish the rating."));
    } finally {
      setSubmitting(false);
    }
  }

  const ratingLabels = ["Poor", "Fair", "Good", "Very good", "Excellent"];
  const ratingSending = loading || submitting;

  return (
    <section className="trade-completion-rating">
      <div className="trade-completion-rating-heading">
        <h3>Rate your trade</h3>
      </div>
      <div className="trade-completion-rating-grid">
        <RatingField label="Your peer" rating={peerRating} ratingLabels={ratingLabels} onChange={setPeerRating} />
        <RatingField
          disabled={ratingSending}
          label={`Your host ${coordinatorName || "coordinator"}`}
          rating={coordinatorRating}
          ratingLabels={ratingLabels}
          onChange={(value) => void selectCoordinatorRating(value)}
        />
      </div>
      {ratingSending ? (
        <p className="trade-rating-sending" role="status">
          <span className="ui-spinner" aria-hidden="true" />
          Sending coordinator rating
        </p>
      ) : submitted ? (
        <p className="trade-rating-thanks" role="status">
          Also {coordinatorName || "your coordinator"} loves you <span aria-hidden="true">❤️</span>
        </p>
      ) : localError ? (
        <p className="field-error" role="alert">
          {localError}
        </p>
      ) : null}
    </section>
  );
}

function RatingField({
  disabled = false,
  label,
  onChange,
  rating,
  ratingLabels
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: number) => void;
  rating: number;
  ratingLabels: string[];
}) {
  return (
    <div className="trade-rating-field">
      <strong>{label}</strong>
      <div className="rating-options" role="radiogroup" aria-label={`${label} rating`}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            aria-checked={rating === value}
            aria-label={`${value} stars, ${ratingLabels[value - 1]}`}
            className={`rating-star-button ${rating >= value ? "rating-star-button-active" : ""}`}
            disabled={disabled}
            key={value}
            onClick={() => onChange(value)}
            role="radio"
            type="button"
          >
            <Star size={26} />
          </button>
        ))}
      </div>
      {rating ? <small>{ratingLabels[rating - 1]}</small> : <small>Not rated</small>}
    </div>
  );
}

type CompletionSummarySide = "maker" | "platform" | "taker";

function CompletedTradeSummary({ order }: { order: OrderDto }) {
  const [side, setSide] = useState<CompletionSummarySide>(order.is_maker ? "maker" : "taker");
  const currencyCode = currencyCodeFromId(order.currency);
  const fallbackSats = firstPositiveNumber(
    order.sent_satoshis,
    order.num_satoshis,
    order.trade_satoshis,
    order.satoshis,
    order.invoice_amount
  );
  const makerIsBuyer = order.is_maker ? order.is_buyer : !order.is_buyer;
  const selectedSummary = side === "maker" ? order.maker_summary : order.taker_summary;
  const selectedIsBuyer = recordBoolean(selectedSummary, "is_buyer", side === "maker" ? makerIsBuyer : !makerIsBuyer);
  const fiatAmount = recordNumber(selectedSummary, selectedIsBuyer ? "sent_fiat" : "received_fiat", order.amount ?? 0);
  const bitcoinAmount = recordNumber(selectedSummary, selectedIsBuyer ? "received_sats" : "sent_sats", fallbackSats);
  const tradeFeeSats = recordNumber(selectedSummary, "trade_fee_sats", 0);
  const tradeFeePercent = recordNumber(selectedSummary, "trade_fee_percent", order.trade_fee_percent ?? 0);
  const isSwap = recordBoolean(selectedSummary, "is_swap", false);
  const swapFeeSats = recordNumber(selectedSummary, "swap_fee_sats", 0);
  const swapFeePercent = recordNumber(selectedSummary, "swap_fee_percent", 0);
  const miningFeeSats = recordNumber(selectedSummary, "mining_fee_sats", 0);

  return (
    <section className="completed-trade-summary">
      <h3>Trade summary</h3>
      <Tabs
        ariaLabel="Trade summary participant"
        className="completed-summary-tabs"
        id="completed-summary"
        onChange={setSide}
        options={[
          {
            value: "maker",
            label: (
              <>
                <RobotAvatar
                  hashId={order.maker_hash_id || order.maker_nick}
                  label={order.maker_nick || "Maker"}
                  size="sm"
                />
                <span>Maker</span>
              </>
            )
          },
          {
            value: "platform",
            ariaLabel: "RoboSats summary",
            label: <img className="completed-summary-platform-mark" alt="" src="/static/assets/vector/R-notext.svg" />
          },
          {
            value: "taker",
            label: (
              <>
                <span>Taker</span>
                <RobotAvatar
                  hashId={order.taker_hash_id || order.taker_nick}
                  label={order.taker_nick || "Taker"}
                  size="sm"
                />
              </>
            )
          }
        ]}
        panelId="completed-summary-panel"
        value={side}
      />

      <div aria-labelledby={tabId("completed-summary", side)} id="completed-summary-panel" role="tabpanel">
        {side === "platform" ? (
          <dl className="completed-summary-details">
            <div>
              <dt>Coordinator</dt>
              <dd>{order.shortAlias || "RoboSats"}</dd>
            </div>
            <div>
              <dt>Order</dt>
              <dd>#{order.id}</dd>
            </div>
            {recordNumber(order.platform_summary, "trade_revenue_sats", 0) > 0 ? (
              <div>
                <dt>Trade revenue</dt>
                <dd>{formatSats(recordNumber(order.platform_summary, "trade_revenue_sats", 0))}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <dl className="completed-summary-details">
            <div>
              <dt>User role</dt>
              <dd>{selectedIsBuyer ? "Buyer" : "Seller"}</dd>
            </div>
            <div>
              <dt>{selectedIsBuyer ? "Fiat sent" : "Fiat received"}</dt>
              <dd>{formatFiat(fiatAmount, currencyCode)}</dd>
            </div>
            <div>
              <dt>{selectedIsBuyer ? "Bitcoin received" : "Bitcoin sent"}</dt>
              <dd>{formatSats(bitcoinAmount)}</dd>
            </div>
            <div>
              <dt>Trade fee</dt>
              <dd>
                {formatSats(tradeFeeSats)}
                {tradeFeePercent > 0 ? ` (${formatTradeFeePercent(tradeFeePercent)})` : ""}
              </dd>
            </div>
            <SwapFeeRows
              isSwap={isSwap}
              miningFeeSats={miningFeeSats}
              swapFeePercent={swapFeePercent}
              swapFeeSats={swapFeeSats}
            />
          </dl>
        )}
      </div>
    </section>
  );
}

function recordNumber(record: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = Number(record?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function recordBoolean(record: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  return typeof record?.[key] === "boolean" ? record[key] : fallback;
}

function firstPositiveNumber(...values: Array<number | null | undefined>): number {
  return values.find((value) => typeof value === "number" && Number.isFinite(value) && value > 0) ?? 0;
}

function SwapFeeRows({
  isSwap,
  miningFeeSats,
  swapFeePercent,
  swapFeeSats
}: {
  isSwap: boolean;
  miningFeeSats: number;
  swapFeePercent: number;
  swapFeeSats: number;
}) {
  if (!isSwap) return null;
  return (
    <>
      <div>
        <dt>Onchain swap fee</dt>
        <dd>
          {formatSats(swapFeeSats)}
          {swapFeePercent > 0 ? ` (${formatPercent(swapFeePercent)})` : ""}
        </dd>
      </div>
      <div>
        <dt>Mining fee</dt>
        <dd>{formatSats(miningFeeSats)}</dd>
      </div>
    </>
  );
}

function formatTradeFeePercent(value: number): string {
  const percentage = value > 0 && value < 1 ? value * 100 : value;
  return formatPercent(percentage);
}

function formatPercent(percentage: number): string {
  return `${Number(percentage.toPrecision(3))}%`;
}
