import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "../../lib/utils";
import { OverlayContainerContext } from "./overlay-context";

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  closeDisabled?: boolean;
  onOpenChange: (open: boolean) => void;
}

let scrollLocks = 0;
let previousOverflow = "";

/** Native modals provide inert background, focus trapping and nested dialog semantics. */
export function Dialog(props: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [container, setContainer] = useState<HTMLDialogElement | null>(null);
  const attachDialog = useCallback((node: HTMLDialogElement | null) => {
    dialogRef.current = node;
    setContainer(node);
  }, []);
  const { open } = props;
  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (scrollLocks++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      if (--scrollLocks === 0) document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={attachDialog}
      tabIndex={-1}
      className={cn("dialog-surface", props.className)}
      aria-labelledby={titleId}
      aria-describedby={props.description ? descriptionId : undefined}
      aria-modal="true"
      // React portal events still bubble through the parent form's component tree.
      onSubmit={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (
          event.key !== "Tab" ||
          event.defaultPrevented ||
          !(event.target instanceof Element) ||
          event.target.closest("dialog") !== event.currentTarget
        )
          return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button, a[href], input, select, textarea, [tabindex], [contenteditable='true']",
          ),
        ).filter(
          (control) =>
            control.tabIndex >= 0 &&
            !control.matches(":disabled") &&
            control.getClientRects().length > 0 &&
            getComputedStyle(control).visibility !== "hidden",
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!props.closeDisabled) props.onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || props.closeDisabled) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          props.onOpenChange(false);
      }}
    >
      <header className="dialog-header">
        <div>
          <p className="ui-eyebrow">AFTER LIFE</p>
          <h3 id={titleId}>{props.title}</h3>
          {props.description && <p id={descriptionId}>{props.description}</p>}
        </div>
        <Button
          aria-label="关闭弹窗"
          className="dialog-close"
          disabled={props.closeDisabled}
          size="icon"
          variant="ghost"
          onClick={() => props.onOpenChange(false)}
        >
          <X aria-hidden="true" size={18} />
        </Button>
      </header>
      <OverlayContainerContext.Provider value={container ?? undefined}>
        {props.children}
      </OverlayContainerContext.Provider>
    </dialog>,
    document.body,
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
}) {
  return (
    <Dialog
      className="dialog-surface-sm"
      closeDisabled={props.loading}
      description={props.description}
      open={props.open}
      title={props.title}
      onOpenChange={props.onOpenChange}
    >
      <div className="dialog-footer">
        <Button
          disabled={props.loading}
          variant="outline"
          onClick={() => props.onOpenChange(false)}
        >
          取消
        </Button>
        <Button
          busy={props.loading}
          variant="destructive"
          onClick={() =>
            void Promise.resolve()
              .then(() => props.onConfirm())
              .catch(() => undefined)
          }
        >
          {props.confirmLabel || "确认删除"}
        </Button>
      </div>
    </Dialog>
  );
}
