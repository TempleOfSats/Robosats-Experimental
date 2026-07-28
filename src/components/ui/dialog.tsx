import {
  type HTMLAttributes,
  type MouseEvent,
  type PropsWithChildren,
  type RefObject,
  useEffect,
  useRef
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

type DialogProps = PropsWithChildren<{
  ariaDescribedby?: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
  closeOnEscape?: boolean;
  dismissOnBackdrop?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  overlayClassName: string;
  panelClassName: string;
  panelProps?: Omit<HTMLAttributes<HTMLDivElement>, "children" | "role">;
}>;

export function Dialog({
  ariaDescribedby,
  ariaLabel,
  ariaLabelledby,
  children,
  closeOnEscape = true,
  dismissOnBackdrop = false,
  initialFocusRef,
  onClose,
  overlayClassName,
  panelClassName,
  panelProps
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const dialogPanel = panel;

    returnFocusRef.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialFocus = initialFocusRef?.current
      ?? panel.querySelector<HTMLElement>("[data-dialog-initial-focus]")
      ?? panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ?? panel;
    initialFocus.focus({ preventScroll: true });

    function isTopmostDialog() {
      const dialogs = document.querySelectorAll<HTMLElement>("[data-modal-dialog='true']");
      return dialogs[dialogs.length - 1] === dialogPanel;
    }

    function getFocusableElements() {
      return Array.from(dialogPanel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => (
          !element.hidden
          && element.getAttribute("aria-hidden") !== "true"
          && element.getClientRects().length > 0
        ));
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopmostDialog()) return;
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialogPanel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogPanel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogPanel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      if (!isTopmostDialog() || dialogPanel.contains(event.target as Node)) return;
      (getFocusableElements()[0] ?? dialogPanel).focus({ preventScroll: true });
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      const returnTarget = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
      });
    };
  }, [closeOnEscape, initialFocusRef]);

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (dismissOnBackdrop) onClose();
    else panelRef.current?.focus({ preventScroll: true });
  }

  const dialog = (
    <div className={overlayClassName} onClick={handleBackdropClick} data-dialog-overlay="true">
      <div
        {...panelProps}
        aria-describedby={ariaDescribedby}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-modal="true"
        className={cn("ui-dialog-panel", panelClassName, panelProps?.className)}
        data-modal-dialog="true"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
