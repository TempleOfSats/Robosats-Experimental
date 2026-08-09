import { useState } from "react";
import type { ReactNode } from "react";
import { Download, ExternalLink, Rocket, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, tabId } from "@/components/ui/tabs";
import { currencyCodeFromId } from "@/domains/orderbook/currencies";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { disputeOutcomeForCurrentRobot } from "@/domains/orders/orderStateMachine";
import { TradeReceipt, type TradeReceiptModel } from "@/domains/orders/TradeReceipt";
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
  rewardClaim?: ReactNode;
  robotHashId: string;
  robotName: string;
};

export function CompletedTradePanel({
  canSubmit,
  coordinatorName,
  loading,
  onPublishRating,
  onStartAgain,
  order,
  rewardClaim,
  robotHashId,
  robotName
}: CompletedTradePanelProps) {
  const receipt = completedTradeReceipt(order, robotHashId, robotName, coordinatorName);
  const rateable = receipt.outcome === "completed";
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
    <div className="trade-finished-stack">
      <TradeReceipt
        model={receipt}
        supplementary={rewardClaim}
        actions={
          <>
            {order.txid ? (
              <Button
                variant="secondary"
                onClick={() =>
                  window.open(blockExplorerUrl(order.txid!, order.network), "_blank", "noopener,noreferrer")
                }
              >
                <ExternalLink size={15} /> View transaction
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => downloadJson(`robosats-trade-${order.id}-overview.json`, tradeOverview)}
            >
              <Download size={15} /> Download overview
            </Button>
            <Button onClick={onStartAgain}>
              <Rocket size={16} /> Start another trade
            </Button>
          </>
        }
        breakdown={
          <>
            {order.maker_summary || order.taker_summary || order.platform_summary ? (
              <CompletedTradeSummary order={order} />
            ) : null}
            <details className="trade-receipt-raw">
              <summary>Raw coordinator data</summary>
              <pre className="receipt-json">{JSON.stringify(tradeOverview, null, 2)}</pre>
            </details>
          </>
        }
      />
      {rateable ? (
        <RatingSubmissionCard
          canSubmit={canSubmit}
          coordinatorName={coordinatorName}
          loading={loading}
          onPublishRating={onPublishRating}
        />
      ) : null}
    </div>
  );
}

function completedTradeReceipt(
  order: OrderDto,
  robotHashId: string,
  robotName: string,
  coordinatorName: string
): TradeReceiptModel {
  const facts = receiptFacts(order, robotHashId, robotName, coordinatorName);
  const disputeOutcome = disputeOutcomeForCurrentRobot(order);

  if (order.status === 12 || order.status === 4) return cancelledReceipt(facts, order);
  if (disputeOutcome) return disputeReceipt(facts, order.currency, disputeOutcome);
  return successfulReceipt(facts);
}

type ReceiptFacts = {
  identity: Pick<TradeReceiptModel, "coordinatorName" | "orderId" | "robotHashId" | "robotName">;
  summary?: Record<string, unknown>;
  isBuyer: boolean;
  isBitcoinSwap: boolean;
  contractAmount?: number;
  contractBitcoin: number;
  contractAmountText: string;
  bitcoinText: string;
  context?: string;
};

function receiptFacts(order: OrderDto, robotHashId: string, robotName: string, coordinatorName: string): ReceiptFacts {
  const summary = order.is_maker ? order.maker_summary : order.is_taker ? order.taker_summary : undefined;
  const isBuyer = recordBoolean(summary, "is_buyer", order.is_buyer);
  const isBitcoinSwap = order.currency === 1000;
  const summaryContractAmount = recordOptionalNumber(summary, isBuyer ? "sent_fiat" : "received_fiat");
  const summaryBitcoin = positiveRecordNumber(summary, isBuyer ? "received_sats" : "sent_sats");
  const contractAmount = finiteNumber(order.amount);
  const contractBitcoin = firstPositiveNumber(
    order.is_buyer ? order.invoice_amount : order.escrow_satoshis,
    order.trade_satoshis,
    order.num_satoshis,
    order.sent_satoshis,
    order.satoshis_now,
    order.satoshis
  );
  const amount = summaryContractAmount ?? contractAmount;
  const bitcoin = summaryBitcoin ?? contractBitcoin;
  const contractAmountText = formatContractAmount(amount, order.currency);
  const bitcoinText = bitcoin > 0 ? formatSats(bitcoin) : "Unavailable";
  const context =
    amount === undefined ? undefined : `${isBitcoinSwap && isBuyer ? "after sending" : "for"} ${contractAmountText}`;
  return {
    identity: { robotName, robotHashId, orderId: order.id, coordinatorName },
    summary,
    isBuyer,
    isBitcoinSwap,
    contractAmount,
    contractBitcoin,
    contractAmountText,
    bitcoinText,
    context
  };
}

function cancelledReceipt(facts: ReceiptFacts, order: OrderDto): TradeReceiptModel {
  const collaborative = order.status === 12;
  return {
    ...facts.identity,
    outcome: "cancelled",
    title: collaborative ? "Collaboratively cancelled" : "This order was cancelled",
    statementLabel: collaborative ? "Both robots agreed to cancel" : "The contract did not complete",
    primaryValue: "No payout",
    statementContext: collaborative ? "Both peers' bonds were returned without penalty." : undefined,
    rows: [
      ...contractRows(facts.contractAmount, facts.contractBitcoin, order.currency),
      { label: "Bond outcome", value: cancellationBondOutcome(order) }
    ]
  };
}

function disputeReceipt(facts: ReceiptFacts, currency: number, outcome: "lost" | "won"): TradeReceiptModel {
  return {
    ...facts.identity,
    outcome: outcome === "won" ? "dispute-won" : "dispute-lost",
    title: outcome === "won" ? "Dispute resolved in your favor" : "Dispute resolved for your peer",
    statementLabel: "Coordinator decision",
    primaryValue: outcome === "won" ? "Your robot won" : "Your peer won",
    statementContext: "Review the contract summary and the coordinator's final order state.",
    rows: [
      ...contractRows(facts.contractAmount, facts.contractBitcoin, currency),
      { label: "Bond outcome", value: disputeBondOutcome(outcome) }
    ]
  };
}

function cancellationBondOutcome(order: Pick<OrderDto, "status" | "is_maker" | "taker_locked">): string {
  if (order.status === 12) return "Both bonds were returned without penalty.";
  if (order.status === 4 && order.is_maker && order.taker_locked === true) {
    return "Your maker bond was settled; the taker bond was returned.";
  }
  if (order.status === 4 && (!order.is_maker || order.taker_locked === false)) {
    return "Your bond was returned without penalty.";
  }
  return "Bond outcome was not reported by the coordinator.";
}

function disputeBondOutcome(outcome: "lost" | "won"): string {
  return outcome === "lost"
    ? "Your bond was settled as part of the dispute resolution."
    : "Your bond was returned; the dispute was resolved in your favor.";
}

function successfulReceipt(facts: ReceiptFacts): TradeReceiptModel {
  const { bitcoinText, isBitcoinSwap, isBuyer, summary } = facts;

  const rows: Array<{ label: string; value: string }> = [];
  const tradeFee = recordOptionalNumber(summary, "trade_fee_sats");
  const tradeFeePercent = recordOptionalNumber(summary, "trade_fee_percent");
  if (tradeFee !== undefined) {
    rows.push({
      label: "Trade fee",
      value: `${formatSats(tradeFee)}${tradeFeePercent && tradeFeePercent > 0 ? ` (${formatTradeFeePercent(tradeFeePercent)})` : ""}`
    });
  }

  return {
    ...facts.identity,
    outcome: "completed",
    title: isBitcoinSwap ? "Bitcoin swap completed" : "Trade completed",
    statementLabel: isBitcoinSwap
      ? `Bitcoin ${isBuyer ? "received" : "sent"}`
      : `You ${isBuyer ? "bought" : "sold"} bitcoin`,
    primaryValue: bitcoinText,
    statementContext: facts.context,
    rows
  };
}

function contractRows(
  amount: number | undefined,
  bitcoin: number,
  currency: number
): Array<{ label: string; value: string }> {
  const isBitcoinSwap = currency === 1000;
  return [
    {
      label: isBitcoinSwap ? "Contract amount" : "Contract fiat",
      value: formatContractAmount(amount, currency)
    },
    {
      label: isBitcoinSwap ? "Bitcoin settlement" : "Contract bitcoin",
      value: bitcoin > 0 ? formatSats(bitcoin) : "Unavailable"
    }
  ];
}

function formatContractAmount(amount: number | undefined, currency: number): string {
  if (amount === undefined) return "Unavailable";
  return currency === 1000
    ? formatSats(Math.round(amount * 100_000_000))
    : formatFiat(amount, currencyCodeFromId(currency));
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
  const amounts = completionAmounts(order.currency, selectedIsBuyer, fiatAmount, bitcoinAmount);

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
              <dt>{amounts.contractLabel}</dt>
              <dd>{amounts.contractValue}</dd>
            </div>
            <div>
              <dt>{amounts.settlementLabel}</dt>
              <dd>{amounts.settlementValue}</dd>
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

function completionAmounts(
  currency: number,
  isBuyer: boolean,
  contractAmount: number,
  settlementSats: number
): { contractLabel: string; contractValue: string; settlementLabel: string; settlementValue: string } {
  const isBitcoinSwap = currency === 1000;
  return {
    contractLabel: isBitcoinSwap
      ? `Contract bitcoin ${isBuyer ? "sent" : "received"}`
      : `Fiat ${isBuyer ? "sent" : "received"}`,
    contractValue: isBitcoinSwap
      ? formatSats(Math.round(contractAmount * 100_000_000))
      : formatFiat(contractAmount, currencyCodeFromId(currency)),
    settlementLabel: isBitcoinSwap
      ? `Settlement bitcoin ${isBuyer ? "received" : "sent"}`
      : `Bitcoin ${isBuyer ? "received" : "sent"}`,
    settlementValue: formatSats(settlementSats)
  };
}

function recordNumber(record: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = Number(record?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function recordOptionalNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const raw = record?.[key];
  if (raw === null || raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function positiveRecordNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = recordOptionalNumber(record, key);
  return value !== undefined && value > 0 ? value : undefined;
}

function finiteNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
