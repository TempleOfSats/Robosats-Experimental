import { BookmarkCheck, Copy, Ellipsis, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { OfferPreset } from "@/domains/pro/portableSettings";

export function OfferPresetsDialog({
  onClose,
  onCreate,
  onDuplicate,
  onEdit,
  onRemove,
  onUse,
  presets
}: {
  onClose: () => void;
  onCreate: () => void;
  onDuplicate: (preset: OfferPreset) => void;
  onEdit: (preset: OfferPreset) => void;
  onRemove: (id: string) => void;
  onUse: (preset: OfferPreset) => void;
  presets: OfferPreset[];
}) {
  const [removingId, setRemovingId] = useState("");

  return (
    <Dialog
      ariaLabelledby="offer-presets-title"
      onClose={onClose}
      overlayClassName="confirm-overlay pro-sheet-overlay"
      panelClassName="confirm-sheet pro-presets-sheet"
    >
        <header className="garage-switcher-header">
          <div className="pro-presets-title">
            <span aria-hidden="true"><BookmarkCheck size={20} /></span>
            <div><h3 id="offer-presets-title">Offer presets</h3><p>Reusable offer presets</p></div>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close offer presets"><X size={18} /></button>
        </header>

        <div className="pro-presets-command">
          <Button className="pro-presets-new" onClick={onCreate} variant="outline"><Plus size={17} /> New preset</Button>
        </div>

        {presets.length ? (
          <div className="pro-presets-list">
            {presets.map((preset) => (
              <article className="pro-preset-card" data-direction={preset.direction === 0 ? "buy" : "sell"} key={preset.id}>
                <div className="pro-preset-card-copy">
                  <div className="pro-preset-card-title">
                    <strong>{preset.name}</strong>
                    {preset.password ? <small>Private</small> : null}
                  </div>
                  <p>{presetTradeLabel(preset)} · {presetAmountLabel(preset)}</p>
                  <small>{preset.paymentMethods.join(", ")} · {formatSignedPercent(preset.premium)} premium · {preset.bond}% bond</small>
                </div>
                {removingId === preset.id ? (
                  <div className="pro-preset-remove-confirm" role="group" aria-label={`Remove ${preset.name}?`}>
                    <span>Remove this preset?</span>
                    <Button autoFocus size="sm" variant="ghost" onClick={() => setRemovingId("")}>Keep</Button>
                    <Button size="sm" variant="destructive" onClick={() => { onRemove(preset.id); setRemovingId(""); }}>Remove</Button>
                  </div>
                ) : (
                  <div className="pro-preset-card-actions">
                    <Button size="sm" onClick={() => onUse(preset)}>Use</Button>
                    <details className="pro-preset-more">
                      <summary aria-label={`More actions for ${preset.name}`} tabIndex={0} title="More preset actions">
                        <Ellipsis size={18} />
                      </summary>
                      <div className="pro-preset-more-menu">
                        <button type="button" onClick={(event) => {
                          closePresetActions(event.currentTarget);
                          onEdit(preset);
                        }}><Pencil size={15} /> Edit</button>
                        <button type="button" onClick={(event) => {
                          closePresetActions(event.currentTarget);
                          onDuplicate(preset);
                        }}><Copy size={15} /> Duplicate</button>
                        <button type="button" onClick={(event) => {
                          closePresetActions(event.currentTarget, false);
                          setRemovingId(preset.id);
                        }}><Trash2 size={15} /> Remove</button>
                      </div>
                    </details>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="pro-presets-empty">
            <BookmarkCheck size={28} aria-hidden="true" />
            <strong>No offer presets yet</strong>
            <p>Create multiple presets to quickly reuse the offer parameters you prefer for different trades.</p>
          </div>
        )}
    </Dialog>
  );
}

function closePresetActions(trigger: HTMLButtonElement, restoreFocus = true) {
  const details = trigger.closest("details");
  const summary = details?.querySelector<HTMLElement>("summary");
  details?.removeAttribute("open");
  if (restoreFocus) summary?.focus();
}

function presetTradeLabel(preset: OfferPreset): string {
  if (preset.isSwap) return preset.direction === 0 ? "Swap In" : "Swap Out";
  return preset.direction === 0 ? `Buy BTC with ${preset.currency}` : `Sell BTC for ${preset.currency}`;
}

function presetAmountLabel(preset: OfferPreset): string {
  if (preset.minAmount && preset.maxAmount) return `${preset.minAmount}–${preset.maxAmount} ${preset.currency}`;
  return `${preset.amount ?? "0"} ${preset.currency}`;
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value}%`;
}
