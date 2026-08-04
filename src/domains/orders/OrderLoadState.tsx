import { AlertTriangle, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrderLoadRecoveryPhase } from "@/domains/orders/orderLoadRecovery";
import type { OrderLoadFailure } from "@/domains/orders/orderStore";

type ColdOrderLoadStateProps = {
  failure?: OrderLoadFailure;
  orderId: number;
  phase: OrderLoadRecoveryPhase;
  reconnectingTor: boolean;
  torReconnectAvailable: boolean;
  torReconnectFailed: boolean;
  onReconnectTor(): void;
  onRetry(): void;
};

export function ColdOrderLoadState({
  failure,
  orderId,
  phase,
  reconnectingTor,
  torReconnectAvailable,
  torReconnectFailed,
  onReconnectTor,
  onRetry
}: ColdOrderLoadStateProps) {
  const retrying = phase === "waiting-to-retry" || phase === "retrying";
  const loading = phase !== "idle" && !reconnectingTor;
  const transientFailure = failure?.kind === "transient";
  const heading = coldOrderLoadHeading(failure, loading, reconnectingTor);
  const loadingLabel = retrying ? "Retrying private trade connection" : "Loading trade";

  return (
    <main className="page page-trade">
      <div className="page-heading">
        <div>
          <p className="app-eyebrow">Order #{orderId || "-"}</p>
          <h2>{heading}</h2>
          {reconnectingTor ? <p>Building a fresh Tor circuit.</p> : null}
          {loading ? <p>{retrying ? "Trying the private connection again." : "Opening the private trade."}</p> : null}
        </div>
      </div>

      {loading ? (
        <div aria-busy="true" aria-label={loadingLabel} aria-live="polite" className="trade-loading" role="status">
          <div className="trade-loading-progress" aria-hidden>
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} />
            ))}
          </div>
          <section className="trade-loading-card trade-loading-card-primary" aria-hidden>
            <Skeleton className="trade-loading-card-title" />
            <Skeleton className="trade-loading-card-line" />
            <Skeleton className="trade-loading-card-line trade-loading-card-line-short" />
            <Skeleton className="trade-loading-card-action" />
          </section>
          <section className="trade-loading-card trade-loading-card-details" aria-hidden>
            <div>
              <Skeleton className="trade-loading-detail-title" />
              <Skeleton className="trade-loading-detail-copy" />
            </div>
            <Skeleton className="trade-loading-detail-chevron" />
          </section>
        </div>
      ) : (
        <>
          {failure && !transientFailure ? (
            <div className="status-panel status-panel-warning order-error-panel" role="alert">
              <AlertTriangle size={18} />
              <span>{failure.message}</span>
            </div>
          ) : null}
          <div aria-live="polite" className="order-load-recovery" role="status">
            {torReconnectFailed ? <p>Tor reconnect was not confirmed. Retry the trade or reconnect Tor.</p> : null}
            <div className="order-load-recovery-actions">
              <Button type="button" onClick={onRetry}>
                <RotateCw size={16} />
                Retry
              </Button>
              {torReconnectAvailable && (transientFailure || reconnectingTor) ? (
                <Button
                  loading={reconnectingTor}
                  loadingLabel="Reconnecting Tor"
                  type="button"
                  variant="secondary"
                  onClick={onReconnectTor}
                >
                  {!reconnectingTor ? <RefreshCw size={16} /> : null}
                  Reconnect Tor
                </Button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function coldOrderLoadHeading(
  failure: OrderLoadFailure | undefined,
  loading: boolean,
  reconnectingTor: boolean
): string {
  if (reconnectingTor) return "Reconnecting Tor";
  if (loading) return "Loading trade";
  if (failure?.kind === "authentication") return "Robot required";
  if (failure?.kind === "not-found") return "Trade unavailable";
  return "Trade not loaded yet";
}
