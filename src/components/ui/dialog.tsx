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
  "summary",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

type DocumentLockState = {
  appRoot?: HTMLElement;
  appRootWasInert: boolean;
  body: Pick<CSSStyleDeclaration, "paddingRight" | "position" | "top" | "width">;
  htmlOverflow: string;
  locationHref: string;
  scrollY: number;
};

let documentLockCount = 0;
let documentLockState: DocumentLockState | undefined;
const openDialogOverlays: Array<{
  element: HTMLElement;
  previousAriaHidden: string | null;
  wasInert: boolean;
}> = [];

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
  const overlayRef = useRef<HTMLDivElement>(null);
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
    const overlay = overlayRef.current;
    if (!overlay) return;
    return lockDocumentForDialog(overlay);
  }, []);

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
        .filter((element) => {
          const closedDetails = element.closest<HTMLDetailsElement>("details:not([open])");
          const isClosedDetailsSummary =
            element.tagName === "SUMMARY" && element.parentElement === closedDetails;
          return (
            !element.hidden &&
            element.getAttribute("aria-hidden") !== "true" &&
            element.getClientRects().length > 0 &&
            (!closedDetails || isClosedDetailsSummary)
          );
        });
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
    <div className={overlayClassName} onClick={handleBackdropClick} data-dialog-overlay="true" ref={overlayRef}>
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

function lockDocumentForDialog(overlay: HTMLElement): () => void {
  documentLockCount += 1;
  if (documentLockCount === 1) {
    const appRoot = document.querySelector<HTMLElement>(".app-runtime")
      ?? document.querySelector<HTMLElement>("#root");
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const bodyPaddingRight = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    documentLockState = {
      appRoot: appRoot ?? undefined,
      appRootWasInert: appRoot?.inert ?? false,
      body: {
        paddingRight: document.body.style.paddingRight,
        position: document.body.style.position,
        top: document.body.style.top,
        width: document.body.style.width
      },
      htmlOverflow: document.documentElement.style.overflow,
      locationHref: window.location.href,
      scrollY: window.scrollY
    };
    if (appRoot) appRoot.inert = true;
    document.documentElement.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${window.scrollY}px`;
    document.body.style.width = "100%";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${bodyPaddingRight + scrollbarWidth}px`;
  }
  const dialogOverlay = {
    element: overlay,
    previousAriaHidden: overlay.getAttribute("aria-hidden"),
    wasInert: overlay.inert
  };
  openDialogOverlays.push(dialogOverlay);
  updateDialogOverlayIsolation();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const overlayIndex = openDialogOverlays.indexOf(dialogOverlay);
    if (overlayIndex >= 0) openDialogOverlays.splice(overlayIndex, 1);
    restoreDialogOverlay(dialogOverlay);
    updateDialogOverlayIsolation();
    documentLockCount = Math.max(0, documentLockCount - 1);
    if (documentLockCount > 0 || !documentLockState) return;

    const state = documentLockState;
    documentLockState = undefined;
    if (state.appRoot) state.appRoot.inert = state.appRootWasInert;
    document.documentElement.style.overflow = state.htmlOverflow;
    document.body.style.paddingRight = state.body.paddingRight;
    document.body.style.position = state.body.position;
    document.body.style.top = state.body.top;
    document.body.style.width = state.body.width;
    if (window.location.href === state.locationHref) window.scrollTo(0, state.scrollY);
  };
}

function updateDialogOverlayIsolation(): void {
  const topmost = openDialogOverlays.at(-1);
  for (const dialog of openDialogOverlays) {
    if (dialog === topmost) {
      restoreDialogOverlay(dialog);
      continue;
    }
    dialog.element.inert = true;
    dialog.element.setAttribute("aria-hidden", "true");
  }
}

function restoreDialogOverlay(dialog: (typeof openDialogOverlays)[number]): void {
  dialog.element.inert = dialog.wasInert;
  if (dialog.previousAriaHidden === null) dialog.element.removeAttribute("aria-hidden");
  else dialog.element.setAttribute("aria-hidden", dialog.previousAriaHidden);
}
