import { BookmarkCheck, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
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
      overlayClassName="confirm-overlay"
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
          <Button onClick={onCreate}><Plus size={17} /> New preset</Button>
        </div>

        {presets.length ? (
          <div className="pro-presets-list">
            {presets.map((preset) => (
              <article className="pro-preset-card" key={preset.id}>
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
                    <Button size="sm" variant="ghost" onClick={() => setRemovingId("")}>Keep</Button>
                    <Button size="sm" variant="destructive" onClick={() => { onRemove(preset.id); setRemovingId(""); }}>Remove</Button>
                  </div>
                ) : (
                  <div className="pro-preset-card-actions">
                    <Button size="sm" onClick={() => onUse(preset)}>Use</Button>
                    <Button size="icon" variant="ghost" onClick={() => onEdit(preset)} aria-label={`Edit ${preset.name}`} title="Edit"><Pencil size={16} /></Button>
                    <Button size="icon" variant="ghost" onClick={() => onDuplicate(preset)} aria-label={`Duplicate ${preset.name}`} title="Duplicate"><Copy size={16} /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setRemovingId(preset.id)} aria-label={`Remove ${preset.name}`} title="Remove"><Trash2 size={16} /></Button>
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
