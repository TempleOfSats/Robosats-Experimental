import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

export interface VisualSelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}

export function VisualSelect({
  ariaLabel,
  className,
  disabled = false,
  iconActionLabel,
  onChange,
  onIconClick,
  options,
  triggerCaption,
  value
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  iconActionLabel?: string;
  onChange: (value: string) => void;
  onIconClick?: () => void;
  options: VisualSelectOption[];
  triggerCaption?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[aria-selected='true']")?.focus();
  }, [open]);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>, direction: 1 | -1) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(".visual-select-option") ?? []);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : items.length - 1
      : (currentIndex + direction + items.length) % items.length;
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>(".visual-select-trigger")?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      if (!open) setOpen(true);
      else moveFocus(event, 1);
    }
    if (event.key === "ArrowUp") {
      if (!open) setOpen(true);
      else moveFocus(event, -1);
    }
  }

  return (
    <div
      className={[
        "visual-select",
        open ? "visual-select-open" : "",
        selected?.icon && onIconClick ? "visual-select-has-icon-action" : "",
        className
      ].filter(Boolean).join(" ")}
      onKeyDown={handleKeyDown}
      ref={rootRef}
    >
      {selected?.icon && onIconClick ? (
        <button
          aria-label={iconActionLabel ?? `View ${selected.label} details`}
          className="visual-select-icon visual-select-icon-action"
          disabled={disabled}
          onClick={onIconClick}
          type="button"
        >
          {selected.icon}
        </button>
      ) : null}
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="visual-select-trigger"
        disabled={disabled || !selected}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {selected?.icon && !onIconClick ? <span className="visual-select-icon">{selected.icon}</span> : null}
        <span className="visual-select-trigger-copy">
          {triggerCaption ? <small>{triggerCaption}</small> : null}
          <strong>{selected?.label ?? "Select"}</strong>
          {!triggerCaption && selected?.description ? <small>{selected.description}</small> : null}
        </span>
        <ChevronDown className="visual-select-chevron" size={18} aria-hidden="true" />
      </button>

      {open ? (
        <div aria-label={ariaLabel} className="visual-select-menu" id={listboxId} ref={menuRef} role="listbox">
          {options.map((option) => {
            const active = option.value === selected?.value;
            return (
              <button
                aria-selected={active}
                className={active ? "visual-select-option visual-select-option-active" : "visual-select-option"}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                {option.icon ? <span className="visual-select-icon">{option.icon}</span> : null}
                <span className="visual-select-option-copy">
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                {active ? <Check className="visual-select-check" size={17} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
