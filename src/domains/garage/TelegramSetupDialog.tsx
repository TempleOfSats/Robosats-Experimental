import { ExternalLink, Send, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";

type TelegramSetupDialogProps = {
  botName: string;
  token: string;
  onClose: () => void;
};

export function TelegramSetupDialog({ botName, token, onClose }: TelegramSetupDialogProps) {
  const links = telegramSetupLinks(botName, token);

  return (
    <div className="telegram-setup-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="telegram-setup-title">
      <section className="telegram-setup-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="take-modal-close" onClick={onClose} type="button" aria-label="Close Telegram setup">
          <X size={20} />
        </button>

        <header>
          <Send size={22} />
          <h2 id="telegram-setup-title">Enable Telegram notifications</h2>
        </header>

        <a className="telegram-setup-qr" href={links.app} aria-label="Open Telegram setup from QR code">
          <QRCodeSVG value={links.app} size={240} level="M" includeMargin bgColor="#ffffff" fgColor="#111111" />
        </a>

        <p>
          Scan the code or open Telegram, then start the bot conversation. Linking Telegram can reduce your anonymity.
        </p>

        <div className="telegram-setup-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={() => window.open(links.browser, "_blank", "noopener,noreferrer")}>
            Browser
            <ExternalLink size={15} />
          </Button>
          <Button type="button" onClick={() => window.location.assign(links.app)}>
            <Send size={15} />
            Enable
          </Button>
        </div>
      </section>
    </div>
  );
}

export function telegramSetupLinks(botName: string, token: string) {
  const domain = encodeURIComponent(botName.replace(/^@/, ""));
  const start = encodeURIComponent(token);
  return {
    app: `tg://resolve?domain=${domain}&start=${start}`,
    browser: `https://t.me/${domain}?start=${start}`
  };
}
