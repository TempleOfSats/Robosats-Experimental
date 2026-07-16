import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Monitor, Pause, Play, RotateCcw, ShieldCheck, Smartphone, Tablet } from "lucide-react";
import { TRADE_PREVIEW_CASES, type TradePreviewCase, type TradePreviewScenario } from "@/domains/orders/tradePreviewFixtures";
import { Button } from "@/components/ui/button";

type PreviewViewport = "mobile" | "tablet" | "desktop";
type PreviewTheme = "light" | "dark";

const VIEWPORTS: Record<PreviewViewport, { width: number; height: number; label: string }> = {
  mobile: { width: 390, height: 844, label: "Mobile" },
  tablet: { width: 768, height: 1024, label: "Tablet" },
  desktop: { width: 1280, height: 800, label: "Desktop" }
};

const GROUPS: TradePreviewCase["group"][] = ["Publish", "Setup", "Trade", "Dispute", "Payout"];

export function TradeLabPage() {
  const [scenario, setScenario] = useState<TradePreviewScenario>("maker-bond");
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
  const [theme, setTheme] = useState<PreviewTheme>("dark");
  const [revision, setRevision] = useState(0);
  const [playing, setPlaying] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const selectedIndex = TRADE_PREVIEW_CASES.findIndex((item) => item.id === scenario);
  const selected = TRADE_PREVIEW_CASES[selectedIndex] ?? TRADE_PREVIEW_CASES[0];
  const dimensions = VIEWPORTS[viewport];
  const previewUrl = useMemo(
    () => `/order/lake/95955?tradePreview=${scenario}&tradeLab=1&revision=${revision}`,
    [revision, scenario]
  );

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const nextIndex = (TRADE_PREVIEW_CASES.findIndex((item) => item.id === scenario) + 1) % TRADE_PREVIEW_CASES.length;
      setScenario(TRADE_PREVIEW_CASES[nextIndex].id);
    }, 3_500);
    return () => window.clearInterval(timer);
  }, [playing, scenario]);

  useEffect(() => {
    applyPreviewTheme(iframeRef.current, theme);
  }, [theme, previewUrl]);

  const move = (direction: -1 | 1) => {
    const nextIndex = (selectedIndex + direction + TRADE_PREVIEW_CASES.length) % TRADE_PREVIEW_CASES.length;
    setScenario(TRADE_PREVIEW_CASES[nextIndex].id);
  };

  return (
    <main className="trade-lab-page">
      <header className="trade-lab-header">
        <div>
          <p className="app-eyebrow">Development tools</p>
          <h1>Trade interface lab</h1>
          <p>Inspect every synthetic protocol state and exercise its local UI behavior.</p>
        </div>
        <div className="trade-lab-safety"><ShieldCheck size={18} /><span><strong>Fixture mode</strong>No funds, coordinator API, or relay traffic.</span></div>
      </header>

      <div className="trade-lab-toolbar" aria-label="Preview controls">
        <div className="trade-lab-transport">
          <Button variant="secondary" size="icon" aria-label="Previous state" title="Previous state" onClick={() => move(-1)}><ChevronLeft size={17} /></Button>
          <Button variant="secondary" size="icon" aria-label={playing ? "Pause automatic preview" : "Play all states"} title={playing ? "Pause" : "Play all states"} onClick={() => setPlaying((value) => !value)}>
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </Button>
          <Button variant="secondary" size="icon" aria-label="Replay state animation" title="Replay animation" onClick={() => setRevision((value) => value + 1)}><RotateCcw size={17} /></Button>
          <Button variant="secondary" size="icon" aria-label="Next state" title="Next state" onClick={() => move(1)}><ChevronRight size={17} /></Button>
        </div>

        <div className="trade-lab-segment" aria-label="Preview viewport">
          <LabSegment active={viewport === "mobile"} label="Mobile" onClick={() => setViewport("mobile")}><Smartphone size={16} /></LabSegment>
          <LabSegment active={viewport === "tablet"} label="Tablet" onClick={() => setViewport("tablet")}><Tablet size={16} /></LabSegment>
          <LabSegment active={viewport === "desktop"} label="Desktop" onClick={() => setViewport("desktop")}><Monitor size={16} /></LabSegment>
        </div>

        <label className="trade-lab-select">
          <span>Theme</span>
          <select value={theme} onChange={(event) => setTheme(event.target.value as PreviewTheme)}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>

        <a className="ui-button bg-transparent text-foreground border h-10 px-4 text-sm" href={previewUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={16} /> Open preview
        </a>
      </div>

      <div className="trade-lab-workspace">
        <nav className="trade-lab-scenarios" aria-label="Trade preview states">
          {GROUPS.map((group) => (
            <section className="trade-lab-group" key={group}>
              <h2>{group}</h2>
              {TRADE_PREVIEW_CASES.filter((item) => item.group === group).map((item) => (
                <button className={item.id === scenario ? "trade-lab-stage trade-lab-stage-active" : "trade-lab-stage"} key={item.id} onClick={() => setScenario(item.id)} type="button">
                  <span>{item.label}</span><small>{item.description}</small>
                </button>
              ))}
            </section>
          ))}
        </nav>

        <section className="trade-lab-preview" aria-label={`${selected.label} preview`}>
          <div className="trade-lab-preview-heading">
            <span><strong>{selected.label}</strong><small>{selected.description}</small></span>
            <span className="trade-lab-dimensions">{dimensions.width} × {dimensions.height}</span>
          </div>
          <div className={`trade-lab-frame-shell trade-lab-frame-shell-${viewport}`}>
            <iframe
              key={previewUrl}
              ref={iframeRef}
              className="trade-lab-frame"
              title={`${selected.label} interactive preview`}
              src={previewUrl}
              style={{ width: dimensions.width, height: dimensions.height }}
              sandbox="allow-same-origin allow-scripts allow-forms allow-modals"
              onLoad={() => applyPreviewTheme(iframeRef.current, theme)}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function LabSegment({ active, children, label, onClick }: { active: boolean; children: ReactNode; label: string; onClick: () => void }) {
  return <button className={active ? "trade-lab-segment-active" : ""} title={label} aria-label={label} aria-pressed={active} onClick={onClick} type="button">{children}<span>{label}</span></button>;
}

function applyPreviewTheme(frame: HTMLIFrameElement | null, theme: PreviewTheme) {
  const root = frame?.contentDocument?.documentElement;
  if (!root) return;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}
