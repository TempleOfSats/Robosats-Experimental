import { HelpCircle } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export function InfoHint({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  const [tapAnchored, setTapAnchored] = useState(false);
  const [tapPosition, setTapPosition] = useState<{ left: number; top: number }>();
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return;

    function dismiss(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setTapAnchored(false);
      }
    }

    function dismissWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setTapAnchored(false);
      }
    }

    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissWithKeyboard);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !tapAnchored) return;
    const timeout = window.setTimeout(() => {
      setOpen(false);
      setTapAnchored(false);
    }, 6_000);
    return () => window.clearTimeout(timeout);
  }, [open, tapAnchored]);

  useLayoutEffect(() => {
    if (!open || !tapAnchored) return;

    function positionNearTrigger() {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const popover = popoverRef.current?.getBoundingClientRect();
      if (!trigger || !popover) return;

      const edge = 12;
      const gap = 8;
      const width = Math.min(popover.width, window.innerWidth - edge * 2);
      const height = Math.min(popover.height, window.innerHeight - edge * 2);
      const centeredLeft = trigger.left + trigger.width / 2 - width / 2;
      const left = Math.min(window.innerWidth - width - edge, Math.max(edge, centeredLeft));
      const fitsAbove = trigger.top - gap - height >= edge;
      const desiredTop = fitsAbove ? trigger.top - gap - height : trigger.bottom + gap;
      const top = Math.min(window.innerHeight - height - edge, Math.max(edge, desiredTop));

      setTapPosition((current) => current?.left === left && current.top === top ? current : { left, top });
    }

    positionNearTrigger();
    window.addEventListener("resize", positionNearTrigger);
    window.addEventListener("scroll", positionNearTrigger, true);
    return () => {
      window.removeEventListener("resize", positionNearTrigger);
      window.removeEventListener("scroll", positionNearTrigger, true);
    };
  }, [open, tapAnchored, title]);

  function toggleFromClick() {
    if (open) {
      setOpen(false);
      setTapAnchored(false);
      return;
    }
    const tapped = typeof matchMedia === "function" && matchMedia("(hover: none), (pointer: coarse)").matches;
    setTapAnchored(tapped);
    setTapPosition(undefined);
    setOpen(true);
  }

  return (
    <span className="info-hint" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More information: ${title}`}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onClick={toggleFromClick}
      >
        <HelpCircle size={14} />
      </button>
      <span
        className={`info-hint-popover${tapAnchored ? " info-hint-popover-tap" : ""}`}
        id={tooltipId}
        ref={popoverRef}
        role="tooltip"
        style={tapPosition ? { left: tapPosition.left, top: tapPosition.top } : undefined}
      >
        {title}
      </span>
    </span>
  );
}
