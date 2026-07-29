import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Clock3, Copy, LoaderCircle, WalletCards } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePaymentExpiry } from "@/domains/payments/paymentExpiry";
import type { PaymentConcept } from "@/domains/payments/payment.types";
import { formatSats } from "@/lib/format";
import { readUiPreferences } from "@/domains/settings/uiPreferences";
import { writeClipboard } from "@/lib/clipboard";

type PaymentQrCardProps = {
  concept: PaymentConcept;
  title: string;
  value: string;
  amountSats?: number | null;
  expiresAt?: string | null;
  footer?: ReactNode;
  openWalletHref?: string;
  onCopy?: (value: string) => void | Promise<void>;
  previewMode?: boolean;
};

export function PaymentQrCard({
  concept,
  title,
  value,
  amountSats,
  expiresAt,
  footer,
  openWalletHref,
  previewMode = false,
  onCopy = writeClipboard
}: PaymentQrCardProps) {
  const paymentUri = openWalletHref ?? value;
  const paymentReady = Boolean(value.trim())
    && typeof amountSats === "number"
    && Number.isFinite(amountSats)
    && amountSats > 0;
  const paymentExpiresAt = useMemo(
    () => resolvePaymentExpiry(concept, value, expiresAt),
    [concept, expiresAt, value]
  );
  const hasWebLn = !previewMode && typeof window !== "undefined" && Boolean((window as Window & { webln?: WebLnProvider }).webln);
  const [qrTheme, setQrTheme] = useState(() => readUiPreferences().qrTheme);
  const [webLnState, setWebLnState] = useState<"idle" | "paying" | "success" | "error">("idle");

  useEffect(() => {
    const update = () => setQrTheme(readUiPreferences().qrTheme);
    window.addEventListener("robosats-ui-preferences", update);
    return () => window.removeEventListener("robosats-ui-preferences", update);
  }, []);

  const handleWebLnPayment = async () => {
    if (webLnState === "paying" || !value) return;
    setWebLnState("paying");
    try {
      await payWithWebLn(value);
      setWebLnState("success");
    } catch {
      setWebLnState("error");
    }
  };

  return (
    <Card className={`payment-card payment-card-${concept}`} aria-label={title}>
      <CardContent>
        <div className="payment-card-body">
          {paymentReady ? (
            <>
              <button
                className="payment-qr-shell"
                aria-label={openWalletHref ? `Open ${title} in wallet` : `${title} QR code`}
                disabled={!openWalletHref}
                onClick={() => openWalletHref && !previewMode && window.open(openWalletHref)}
                title={openWalletHref ? previewMode ? "Wallet launch disabled in fixture mode" : "Open in Lightning wallet" : undefined}
                type="button"
              >
                <QRCodeSVG value={paymentUri} size={304} level="Q" includeMargin bgColor={qrTheme === "screen" ? "#101010" : "#ffffff"} fgColor={qrTheme === "screen" ? "#f5f5f2" : "#000000"} />
                <span className="payment-qr-logo" aria-hidden="true">
                  <img src="/static/assets/vector/R-notext.svg" alt="" />
                </span>
              </button>
              <div className="payment-primary">
                <div className="payment-amount-block">
                  <span>Amount to lock</span>
                  <strong className="payment-amount tabular amount-mono">{formatSats(amountSats)}</strong>
                </div>
                {paymentExpiresAt ? (
                  <div className="payment-expiry">
                    <Clock3 size={16} />
                    <PaymentCountdown expiresAt={paymentExpiresAt} />
                  </div>
                ) : null}
                <div className="payment-actions">
                  <Button onClick={() => onCopy(value)} disabled={webLnState === "paying"}>
                    <Copy size={16} />
                    Copy
                  </Button>
                  {hasWebLn ? (
                    <Button
                      variant="secondary"
                      loading={webLnState === "paying"}
                      loadingLabel="Paying with WebLN"
                      onClick={handleWebLnPayment}
                    >
                      <WalletCards size={16} /> WebLN
                    </Button>
                  ) : null}
                </div>
                {webLnState === "success" ? (
                  <p className="payment-action-status payment-action-status-success" role="status">
                    Payment completed in your WebLN wallet.
                  </p>
                ) : webLnState === "error" ? (
                  <p className="payment-action-status payment-action-status-error" role="alert">
                    Your WebLN wallet could not complete the payment. Check it and try again.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <div className="payment-preparing" role="status" aria-live="polite">
              <span className="payment-preparing-icon" aria-hidden="true">
                <LoaderCircle size={30} />
              </span>
              <strong>Preparing payment</strong>
              <p>Waiting for the coordinator invoice and amount.</p>
            </div>
          )}
        </div>
        {footer ? <div className="payment-card-footer">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

interface WebLnProvider {
  enable(): Promise<void>;
  sendPayment(invoice: string): Promise<unknown>;
}

async function payWithWebLn(invoice: string) {
  const provider = (window as Window & { webln?: WebLnProvider }).webln;
  if (!provider) throw new Error("WebLN is unavailable.");
  await provider.enable();
  await provider.sendPayment(invoice);
}

function PaymentCountdown({ expiresAt }: { expiresAt: string }) {
  const deadline = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    const update = () => setRemainingMs(Math.max(0, deadline - Date.now()));
    update();
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return;
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  return (
    <span aria-live="off" title={Number.isFinite(deadline) ? new Date(deadline).toLocaleString() : undefined}>
      <small>Expires in</small>
      <strong className="payment-countdown tabular">{formatCountdown(remainingMs)}</strong>
    </span>
  );
}

function formatCountdown(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "Expired";
  const totalSeconds = Math.floor(remainingMs / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
}
