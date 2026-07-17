import { type ReactNode, useEffect, useState } from "react";
import {
  Activity,
  BadgePercent,
  Bitcoin,
  Bot,
  ChevronDown,
  CircleDollarSign,
  ExternalLink,
  FileText,
  Fingerprint,
  Flag,
  Gauge,
  GitCommitHorizontal,
  Globe2,
  HeartHandshake,
  KeyRound,
  Landmark,
  Link2,
  Mail,
  Plus,
  RefreshCw,
  Scale,
  Send,
  Server,
  ShieldCheck,
  ShoppingBasket,
  Star,
  Trash2,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  CoordinatorContact,
  CoordinatorInfo,
  CoordinatorSummary,
  Network as BitcoinNetwork
} from "@/domains/coordinators/coordinator.types";
import { compareCoordinatorsByEstablished } from "@/domains/coordinators/coordinatorOrder";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { fetchCoordinatorRatings, type CoordinatorRating } from "@/domains/coordinators/coordinatorRatings";
import { formatSats, truncateMiddle } from "@/lib/format";
import { toUserMessage } from "@/lib/userError";

export function CoordinatorsPage() {
  const coordinators = useFederationStore((state) => state.coordinators);
  const lastRefreshed = useFederationStore((state) => state.lastRefreshed);
  const network = useFederationStore((state) => state.network);
  const refreshCoordinators = useFederationStore((state) => state.refreshCoordinators);
  const toggleCoordinator = useFederationStore((state) => state.toggleCoordinator);
  const addCustomCoordinator = useFederationStore((state) => state.addCustomCoordinator);
  const removeCustomCoordinator = useFederationStore((state) => state.removeCustomCoordinator);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAlias, setSelectedAlias] = useState<string>();
  const [ratings, setRatings] = useState<Record<string, CoordinatorRating>>({});
  const [customAlias, setCustomAlias] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customError, setCustomError] = useState("");
  const displayCoordinators = coordinators
    .filter((coordinator) => coordinator.shortAlias !== "local")
    .sort(compareCoordinatorsByEstablished);
  const selectedCoordinator = displayCoordinators.find((coordinator) => coordinator.shortAlias === selectedAlias);

  useEffect(() => {
    const nonLocalCoordinators = coordinators.filter((coordinator) => coordinator.shortAlias !== "local");
    if (nonLocalCoordinators.some((coordinator) => coordinator.loading || coordinator.online)) return;
    void refreshCoordinators();
  }, [coordinators, refreshCoordinators]);

  useEffect(() => {
    void fetchCoordinatorRatings(coordinators).then(setRatings).catch(() => undefined);
  }, [coordinators.map((item) => `${item.shortAlias}:${item.url}:${item.enabled}`).join("|")]);

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshCoordinators({ force: true });
    } finally {
      setRefreshing(false);
    }
  }

  function submitCustomCoordinator() {
    const alias = customAlias.trim();
    const url = customUrl.trim().replace(/\/$/, "");
    if (!alias) {
      setCustomError("Enter a coordinator alias.");
      return;
    }
    if (!isHttpUrl(url)) {
      setCustomError("Enter a complete HTTP or HTTPS coordinator URL.");
      return;
    }
    const normalizedAlias = normalizeAlias(alias);
    if (!normalizedAlias) {
      setCustomError("Use letters, numbers, dashes, or underscores in the alias.");
      return;
    }
    if (displayCoordinators.some((coordinator) => coordinator.shortAlias === normalizedAlias)) {
      setCustomError("A coordinator with this alias already exists.");
      return;
    }
    addCustomCoordinator(alias, url);
    setCustomAlias("");
    setCustomUrl("");
    setCustomError("");
  }

  return (
    <main className="page page-narrow coordinators-page">
      <div className="page-heading coordinator-table-heading">
        <div>
          <h2>Coordinators</h2>
          {lastRefreshed ? <p>Live federation data updated {formatTimestamp(lastRefreshed)}</p> : null}
        </div>
        <Button className="coordinator-refresh-button" loading={refreshing} onClick={() => void refresh()} variant="secondary">
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>

      <section className="coordinator-directory-table" aria-label="RoboSats coordinators">
        <div className="coordinator-directory-header">
          <span>Coordinator</span>
          <span>Rating</span>
          <span>Up</span>
          <span>Enabled</span>
        </div>
        {displayCoordinators.map((coordinator) => {
          const rating = ratingFor(coordinator, ratings);
          return (
            <div
              className={coordinator.online ? "coordinator-directory-row coordinator-directory-row-online" : "coordinator-directory-row"}
              key={coordinator.shortAlias}
            >
              <button className="coordinator-directory-name" type="button" onClick={() => setSelectedAlias(coordinator.shortAlias)} aria-label={`Open ${coordinator.longAlias} coordinator details`}>
                <img className="coordinator-avatar coordinator-avatar-lg" src={coordinator.avatarUrl} alt="" />
                <strong>{coordinator.longAlias}</strong>
              </button>
              <span className="coordinator-rating-cell">
                {rating.count > 0 ? <><RatingStars rating={rating.score} /><small>({rating.count})</small></> : <small>Not rated</small>}
              </span>
              <span className="coordinator-status-cell" title={coordinatorStatusTitle(coordinator)}>
                {coordinator.loading ? <RefreshCw className="coordinator-status-spinner" size={19} /> : <Link2 size={20} />}
              </span>
              <label className={coordinator.enabled ? "coordinator-enabled-cell" : "coordinator-enabled-cell coordinator-enabled-cell-muted"}>
                <input type="checkbox" checked={coordinator.enabled} onChange={() => toggleCoordinator(coordinator.shortAlias)} aria-label={`Enable ${coordinator.longAlias}`} />
              </label>
            </div>
          );
        })}
      </section>

      <details className="details-panel coordinator-custom-panel">
        <summary>Custom coordinator</summary>
        <form className="payout-form" onSubmit={(event) => { event.preventDefault(); submitCustomCoordinator(); }}>
          <label className="field-block">Alias<input value={customAlias} onChange={(event) => { setCustomAlias(event.target.value); setCustomError(""); }} placeholder="my-coordinator" /></label>
          <label className="field-block">URL<input value={customUrl} onChange={(event) => { setCustomUrl(event.target.value); setCustomError(""); }} placeholder="http://...onion" /></label>
          {customError ? <p className="form-error" role="alert">{customError}</p> : null}
          <Button type="submit"><Plus size={15} /> Add coordinator</Button>
          {displayCoordinators.filter((item) => item.federated === false).map((item) => (
            <Button key={item.shortAlias} type="button" variant="ghost" onClick={() => removeCustomCoordinator(item.shortAlias)}><Trash2 size={14} /> Remove {item.longAlias}</Button>
          ))}
        </form>
      </details>

      {selectedCoordinator ? (
        <CoordinatorDetailDialog
          coordinator={selectedCoordinator}
          lastRefreshed={lastRefreshed}
          network={network}
          rating={ratingFor(selectedCoordinator, ratings)}
          onClose={() => setSelectedAlias(undefined)}
        />
      ) : null}
    </main>
  );
}

export function CoordinatorDetailDialog({
  compact = false,
  coordinator,
  lastRefreshed,
  network,
  rating,
  onClose
}: {
  compact?: boolean;
  coordinator: CoordinatorSummary;
  lastRefreshed?: number;
  network: BitcoinNetwork;
  rating: CoordinatorRating;
  onClose: () => void;
}) {
  const info = coordinator.info;
  const hostedUrl = isHttpUrl(coordinator.url) ? coordinator.url : undefined;
  const networkUrls = network === "mainnet" ? coordinator.mainnet : coordinator.testnet;
  const policies = Object.entries(coordinator.policies ?? {});
  const notice = info?.notice_message ? plainText(info.notice_message) : "";

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="coordinator-dialog-overlay" onClick={onClose}>
      <aside
        className={compact
          ? "coordinator-dialog coordinator-production-dialog coordinator-choice-dialog"
          : "coordinator-dialog coordinator-production-dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coordinator-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="take-modal-close" onClick={onClose} type="button" aria-label="Close coordinator details">
          <X size={20} />
        </button>

        <header className="coordinator-dialog-header">
          <h2 id="coordinator-dialog-title">{coordinator.longAlias}</h2>
          <img className="coordinator-avatar coordinator-dialog-avatar" src={coordinator.avatarUrl} alt="" />
          {coordinator.motto ? <p>{coordinator.motto}</p> : null}
          <CoordinatorStatus coordinator={coordinator} lastRefreshed={lastRefreshed} />
          {rating.count > 0 ? (
            <div className="coordinator-dialog-rating"><RatingStars rating={rating.score} /><span>({rating.count})</span></div>
          ) : <span className="coordinator-unrated">No coordinator ratings yet</span>}
          {!compact ? <ContactIcons contact={coordinator.contact} /> : null}
          {coordinator.badgeIcons.length > 0 ? (
            <div className="coordinator-dialog-badges" aria-label="Coordinator badges">
              {coordinator.badgeIcons.map((badge) => (
                <img
                  alt={badge.label}
                  className={badge.active ? "coordinator-dialog-badge" : "coordinator-dialog-badge coordinator-dialog-badge-muted"}
                  key={badge.key}
                  src={badge.iconUrl}
                  title={badge.title}
                />
              ))}
            </div>
          ) : null}
        </header>

        {info?.notice_severity && info.notice_severity !== "none" && notice ? (
          <div className={`coordinator-notice coordinator-notice-${info.notice_severity}`} role="status">
            <strong>Coordinator notice</strong>
            <p>{notice}</p>
          </div>
        ) : null}

        <div className="coordinator-dialog-details coordinator-profile-details">
          {coordinator.description ? <DetailRow icon={<FileText size={21} />} label="Coordinator description">{coordinator.description}</DetailRow> : null}
          {coordinator.established ? <DetailRow icon={<Flag size={21} />} label="Established">{formatEstablished(coordinator.established)}</DetailRow> : null}
          {!compact && hostedUrl ? (
            <DetailRow icon={<Globe2 size={21} />} label={`${network} hosted web app`}>
              <a className="coordinator-dialog-detail-link" href={hostedUrl} rel="noreferrer" target="_blank">{displayUrl(hostedUrl)}<ExternalLink size={14} /></a>
            </DetailRow>
          ) : null}
        </div>

        {info ? <TradingTerms info={info} badges={coordinator.badges} /> : (
          <div className="coordinator-data-unavailable" role="status">
            <Server size={20} />
            <div><strong>Live API details unavailable</strong><span>{coordinator.loading ? "Connecting to this coordinator..." : "Refresh to try this coordinator again."}</span></div>
          </div>
        )}

        {!compact && info ? <ActivityDetails info={info} /> : null}

        {policies.length > 0 ? (
          <CoordinatorDisclosure icon={<ShieldCheck size={18} />} label="Policies" summary={`${policies.length} published rules`}>
            <ol className="coordinator-policy-list">
              {policies.map(([title, description]) => <li key={title}><strong>{title}</strong><p>{description}</p></li>)}
            </ol>
          </CoordinatorDisclosure>
        ) : null}

        {!compact && info ? <TechnicalDetails coordinator={coordinator} info={info} networkUrls={networkUrls} /> : null}
      </aside>
    </div>
  );
}

function TradingTerms({ info, badges }: { info: CoordinatorInfo; badges?: CoordinatorSummary["badges"] }) {
  return (
    <section className="coordinator-live-section" aria-labelledby="coordinator-terms-title">
      <div className="coordinator-section-heading"><div><Landmark size={18} /><h3 id="coordinator-terms-title">Trading terms</h3></div><span>Live</span></div>
      <div className="coordinator-metric-grid">
        <Metric icon={<BadgePercent size={17} />} label="Maker fee" value={formatRate(info.maker_fee)} />
        <Metric icon={<BadgePercent size={17} />} label="Taker fee" value={formatRate(info.taker_fee)} />
        <Metric icon={<Scale size={17} />} label="Default bond" value={formatPercent(info.bond_size)} />
        <Metric icon={<Gauge size={17} />} label="Order range" value={`${formatSats(info.min_order_size)} - ${formatSats(info.max_order_size)}`} wide />
        <Metric
          icon={<Link2 size={17} />}
          label="On-chain swaps"
          value={info.swap_enabled ? `${formatPercent(info.current_swap_fee_rate)} fee` : "Disabled"}
        />
        {info.swap_enabled ? <Metric icon={<Bitcoin size={17} />} label="Maximum swap" value={formatSats(info.max_swap)} /> : null}
        {badges && Number(badges.donatesToDevFund) > 0 ? (
          <Metric icon={<HeartHandshake size={17} />} label="Development fund" value={`${badges.donatesToDevFund}% of profits`} wide />
        ) : null}
      </div>
    </section>
  );
}

function ActivityDetails({ info }: { info: CoordinatorInfo }) {
  return (
    <CoordinatorDisclosure icon={<Activity size={18} />} label="Market activity" summary="Current book and coordinator usage">
      <div className="coordinator-metric-grid coordinator-metric-grid-secondary">
        <Metric icon={<ShoppingBasket size={17} />} label="Public buy orders" value={formatCount(info.num_public_buy_orders)} />
        <Metric icon={<ShoppingBasket size={17} />} label="Public sell orders" value={formatCount(info.num_public_sell_orders)} />
        <Metric icon={<CircleDollarSign size={17} />} label="Book liquidity" value={formatSats(info.book_liquidity)} />
        <Metric icon={<Bot size={17} />} label="Active robots today" value={formatCount(info.active_robots_today)} />
        <Metric icon={<BadgePercent size={17} />} label="24h non-KYC premium" value={formatPercent(info.last_day_nonkyc_btc_premium)} />
        <Metric icon={<Bitcoin size={17} />} label="24h contracted volume" value={formatBtcVolume(info.last_day_volume)} />
        <Metric icon={<Bitcoin size={17} />} label="Lifetime volume" value={formatBtcVolume(info.lifetime_volume)} wide />
      </div>
    </CoordinatorDisclosure>
  );
}

function TechnicalDetails({ coordinator, info, networkUrls }: { coordinator: CoordinatorSummary; info: CoordinatorInfo; networkUrls?: CoordinatorSummary["mainnet"] }) {
  const runtime = formatVersion(info.version);
  const nodeId = info.node_id?.trim();
  const commit = info.robosats_running_commit_hash?.trim();
  const endpoints = Object.entries(networkUrls ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1] && isHttpUrl(entry[1])));
  return (
    <CoordinatorDisclosure icon={<Server size={18} />} label="Technical details" summary="Runtime, node and endpoints">
      <dl className="coordinator-technical-list">
        {runtime ? <TechnicalRow label="RoboSats coordinator" value={runtime} /> : null}
        {info.lnd_version ? <TechnicalRow label="LND" value={info.lnd_version} /> : null}
        {info.cln_version ? <TechnicalRow label="CLN" value={info.cln_version} /> : null}
        {info.network ? <TechnicalRow label="Bitcoin network" value={info.network} /> : null}
        {nodeId ? (
          <TechnicalRow label={info.node_alias ? `Lightning node: ${info.node_alias}` : "Lightning node"}>
            <a href={info.network === "testnet" ? `https://1ml.com/testnet/node/${nodeId}` : `https://amboss.space/node/${nodeId}`} rel="noreferrer" target="_blank">{truncateMiddle(nodeId, 8)}<ExternalLink size={13} /></a>
          </TechnicalRow>
        ) : null}
        {commit ? (
          <TechnicalRow label="Coordinator commit">
            <a href={`https://github.com/RoboSats/robosats/tree/${encodeURIComponent(commit.split(" ")[0])}`} rel="noreferrer" target="_blank">{truncateMiddle(commit, 8)}<GitCommitHorizontal size={13} /></a>
          </TechnicalRow>
        ) : null}
        {info.market_price_apis ? <TechnicalRow label="Market price sources" value={info.market_price_apis} /> : null}
        {coordinator.nostrHexPubkey ? <TechnicalRow label="Nostr public key" value={truncateMiddle(coordinator.nostrHexPubkey, 8)} /> : null}
        {endpoints.map(([origin, url]) => (
          <TechnicalRow key={origin} label={`${origin} endpoint`}><a href={url} rel="noreferrer" target="_blank">{displayUrl(url)}<ExternalLink size={13} /></a></TechnicalRow>
        ))}
      </dl>
    </CoordinatorDisclosure>
  );
}

function CoordinatorDisclosure({ children, icon, label, summary }: { children: ReactNode; icon: ReactNode; label: string; summary: string }) {
  return (
    <details className="coordinator-data-disclosure">
      <summary><span className="coordinator-disclosure-icon">{icon}</span><span><strong>{label}</strong><small>{summary}</small></span><ChevronDown className="coordinator-disclosure-chevron" size={18} /></summary>
      <div className="coordinator-disclosure-body">{children}</div>
    </details>
  );
}

function Metric({ icon, label, value, wide = false }: { icon: ReactNode; label: string; value: string; wide?: boolean }) {
  return <div className={wide ? "coordinator-metric coordinator-metric-wide" : "coordinator-metric"}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function TechnicalRow({ children, label, value }: { children?: ReactNode; label: string; value?: string }) {
  return <div><dt>{label}</dt><dd>{children ?? value}</dd></div>;
}

function CoordinatorStatus({ coordinator, lastRefreshed }: { coordinator: CoordinatorSummary; lastRefreshed?: number }) {
  const state = coordinator.loading ? "Checking" : coordinator.online ? "Online" : "Unavailable";
  return <span className={`coordinator-live-status coordinator-live-status-${state.toLowerCase()}`}><span />{state}{lastRefreshed && !coordinator.loading ? ` - ${formatTimestamp(lastRefreshed)}` : ""}</span>;
}

function ContactIcons({ contact }: { contact?: CoordinatorContact }) {
  const contacts = Object.entries(contact ?? {}).filter(([key, value]) => key !== "fingerprint" && Boolean(value));
  if (contacts.length === 0) return null;
  return (
    <div className="coordinator-contact-icons" aria-label="Coordinator contact methods">
      {contacts.map(([key, value]) => {
        const href = contactHref(key, String(value));
        const title = key === "pgp" && contact?.fingerprint ? `PGP fingerprint: ${formatFingerprint(contact.fingerprint)}` : contactLabel(key);
        if (!href) return <span key={key} title={title}>{contactIcon(key)}</span>;
        return <a href={href} key={key} rel="noreferrer" target={href.startsWith("mailto:") || href.startsWith("nostr:") ? undefined : "_blank"} title={title}>{contactIcon(key)}</a>;
      })}
    </div>
  );
}

function DetailRow({ children, icon, label }: { children: ReactNode; icon: ReactNode; label: string }) {
  return <div className="coordinator-dialog-detail-row"><span>{icon}</span><p>{children}</p><small>{label}</small></div>;
}

function RatingStars({ rating }: { rating: number }) {
  return (
    <span className="coordinator-rating-stars" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, index) => <Star className={index < Math.round(rating) ? "coordinator-star-filled" : "coordinator-star-empty"} fill="currentColor" key={index} size={21} />)}
    </span>
  );
}

function ratingFor(coordinator: CoordinatorSummary, ratings: Record<string, CoordinatorRating> = {}): CoordinatorRating {
  return ratings[coordinator.shortAlias] ?? { score: 0, count: 0 };
}

function coordinatorStatusTitle(coordinator: CoordinatorSummary): string {
  if (coordinator.loading) return "Checking coordinator API";
  if (coordinator.online) return "Coordinator API reachable";
  return coordinator.error ? toUserMessage(coordinator.error, "Coordinator unavailable.") : "Coordinator API unavailable";
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function isHttpUrl(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function contactHref(key: string, value: string): string | undefined {
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) return value;
  if (key === "email") return `mailto:${value}`;
  if (key === "telegram") return `https://t.me/${value.replace(/^@/, "")}`;
  if (key === "matrix") return `https://matrix.to/#/${value}`;
  if (key === "nostr") return `nostr:${value}`;
  if (key === "reddit") return `https://www.reddit.com/${/^[ru]\//.test(value) ? value : `user/${value.replace(/^@/, "")}`}`;
  if (key === "twitter") return `https://x.com/${value.replace(/^@/, "")}`;
  return undefined;
}

function contactIcon(key: string): ReactNode {
  if (key === "email") return <Mail size={21} />;
  if (key === "telegram") return <Send size={21} />;
  if (key === "simplex") return <SimplexIcon size={21} />;
  if (key === "website") return <Globe2 size={21} />;
  if (key === "pgp") return <KeyRound size={21} />;
  if (key === "nostr") return <Fingerprint size={21} />;
  return <ExternalLink size={21} />;
}

function SimplexIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" fill="currentColor" height={size} viewBox="0 0 1080 1080" width={size}>
      <g transform="matrix(4.68 0 0 4.68 668.81 540.67)">
        <path
          d="M 642.628 136.08 L 680.309 173.782 L 699.513 154.567 L 699.506 154.561 L 737.917 116.134 L 700.236 78.4367 L 700.243 78.4334 L 681.404 59.5826 L 642.993 98.014 L 642.99 98.0104 L 681.401 59.5829 L 643.725 21.881 L 662.929 2.6652 L 700.605 40.3673 L 739.016 1.93511 L 757.855 20.7859 L 719.443 59.2176 L 757.121 96.918 L 795.533 58.4875 L 814.373 77.3382 L 775.959 115.768 L 813.643 153.471 L 794.439 172.687 L 756.756 134.984 L 718.348 173.415 L 756.031 211.119 L 736.827 230.335 L 699.144 192.63 L 660.74 231.065 L 641.901 212.214 L 680.306 173.78 L 642.625 136.083 Z"
          transform="translate(-728.14, -116.5)"
        />
      </g>
      <g transform="matrix(4.59 0 0 4.59 277.43 543.42)">
        <path
          d="M 604.77 59.7651 L 642.446 97.4664 L 680.856 59.035 L 699.696 77.8858 L 661.285 116.317 L 698.966 154.019 L 679.762 173.235 L 642.081 135.532 L 603.675 173.965 L 584.836 155.114 L 623.243 116.682 L 585.566 78.9809 L 604.77 59.7651 Z"
          transform="translate(-642.27, -116.5)"
        />
      </g>
    </svg>
  );
}

function contactLabel(key: string): string {
  return key === "pgp" ? "PGP public key" : key.charAt(0).toUpperCase() + key.slice(1);
}

function formatRate(value: number): string {
  const rate = Number(value);
  return Number.isFinite(rate) ? `${(rate * 100).toFixed(3)}%` : "Unavailable";
}

function formatPercent(value: number): string {
  const percent = Number(value);
  return Number.isFinite(percent) ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(percent)}%` : "Unavailable";
}

function formatCount(value: number): string {
  return Number.isFinite(Number(value)) ? new Intl.NumberFormat().format(Number(value)) : "Unavailable";
}

function formatBtcVolume(value: number): string {
  const number = Number(value);
  return Number.isFinite(number) ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(number)} BTC` : "Unavailable";
}

function formatVersion(version: CoordinatorInfo["version"]): string | undefined {
  if (!version) return undefined;
  const parts = [version.major, version.minor, version.patch];
  return parts.every((part) => Number.isFinite(Number(part))) ? `v${parts.join(".")}` : undefined;
}

function formatEstablished(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(value);
}

function formatFingerprint(value: string): string {
  return value.replace(/\s/g, "").match(/.{1,4}/g)?.join(" ") ?? value;
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch { return value; }
}

function plainText(value: string): string {
  if (typeof DOMParser === "undefined") return value;
  return new DOMParser().parseFromString(value, "text/html").body.textContent?.trim() ?? "";
}
