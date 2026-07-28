import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TabOption<Value extends string> = {
  value: Value;
  label: ReactNode;
  ariaLabel?: string;
};

type TabsProps<Value extends string> = {
  ariaLabel: string;
  className?: string;
  id: string;
  onChange: (value: Value) => void;
  options: Array<TabOption<Value>>;
  panelId: string;
  value: Value;
};

export function Tabs<Value extends string>({
  ariaLabel,
  className,
  id,
  onChange,
  options,
  panelId,
  value
}: TabsProps<Value>) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, current: Value) => {
    const next = nextTabValue(options.map((option) => option.value), current, event.key);
    if (!next) return;
    event.preventDefault();
    onChange(next);
    window.requestAnimationFrame(() => document.getElementById(tabId(id, next))?.focus());
  };

  return (
    <div className={cn(className)} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          aria-controls={panelId}
          aria-label={option.ariaLabel}
          aria-selected={value === option.value}
          id={tabId(id, option.value)}
          key={option.value}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => move(event, option.value)}
          role="tab"
          tabIndex={value === option.value ? 0 : -1}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function tabId(id: string, value: string): string {
  return `${id}-tab-${value.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function nextTabValue<Value extends string>(
  values: Value[],
  current: Value,
  key: string
): Value | undefined {
  if (values.length === 0) return undefined;
  if (key === "Home") return values[0];
  if (key === "End") return values.at(-1);
  if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "ArrowUp" && key !== "ArrowDown") {
    return undefined;
  }
  const direction = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  const currentIndex = Math.max(0, values.indexOf(current));
  return values[(currentIndex + direction + values.length) % values.length];
}
