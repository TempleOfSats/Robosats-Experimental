import type { ReactNode } from "react";
import { CheckCircle2, Handshake, Scale, Trophy } from "lucide-react";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";

export type TradeReceiptOutcome = "cancelled" | "completed" | "dispute-lost" | "dispute-won";

export type TradeReceiptModel = {
  outcome: TradeReceiptOutcome;
  title: string;
  timestamp?: string;
  statementLabel: string;
  primaryValue: string;
  statementContext?: string;
  rows: Array<{ label: string; value: string }>;
  robotName: string;
  robotHashId: string;
  orderId: number;
  coordinatorName: string;
};

export function TradeReceipt({
  actions,
  breakdown,
  focusTitle = false,
  model,
  supplementary,
  titleId
}: {
  actions?: ReactNode;
  breakdown?: ReactNode;
  focusTitle?: boolean;
  model: TradeReceiptModel;
  supplementary?: ReactNode;
  titleId?: string;
}) {
  const OutcomeIcon = outcomeIcon(model.outcome);

  return (
    <article className={`trade-receipt trade-receipt-${model.outcome}`}>
      <header className="trade-receipt-header">
        <span className="trade-receipt-outcome-icon" aria-hidden="true">
          <OutcomeIcon size={20} />
        </span>
        <div>
          <h2
            data-dialog-initial-focus={focusTitle ? "" : undefined}
            id={titleId}
            tabIndex={focusTitle ? -1 : undefined}
          >
            {model.title}
          </h2>
          {model.timestamp ? <p>{model.timestamp}</p> : null}
        </div>
      </header>
      <section className="trade-receipt-statement">
        <span className="trade-receipt-label">{model.statementLabel}</span>
        <strong className="trade-receipt-value">{model.primaryValue}</strong>
        {model.statementContext ? <p>{model.statementContext}</p> : null}
        {model.rows.length > 0 ? (
          <dl className="trade-receipt-rows">
            {model.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="trade-receipt-identity">
          <RobotAvatar hashId={model.robotHashId || model.robotName} label={model.robotName} size="sm" />
          <span>
            <strong>{model.robotName}</strong>
            <small>
              #{model.orderId} · {model.coordinatorName}
            </small>
          </span>
        </div>
        {supplementary ? <div className="trade-receipt-supplementary">{supplementary}</div> : null}
      </section>
      {breakdown ? (
        <details className="trade-receipt-breakdown">
          <summary>Full breakdown</summary>
          <div>{breakdown}</div>
        </details>
      ) : null}
      {actions ? <div className="trade-receipt-actions">{actions}</div> : null}
      <footer className="trade-receipt-privacy">
        This summary is kept in your encrypted Fleet history stored over nostr.
      </footer>
    </article>
  );
}

function outcomeIcon(outcome: TradeReceiptOutcome) {
  switch (outcome) {
    case "dispute-won":
      return Trophy;
    case "dispute-lost":
      return Scale;
    case "cancelled":
      return Handshake;
    case "completed":
    default:
      return CheckCircle2;
  }
}
