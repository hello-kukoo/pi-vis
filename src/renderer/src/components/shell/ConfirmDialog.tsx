import type React from "react";
import { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useEscapeClaim } from "../../hooks/useEscapeClaim.js";
import { FadeText } from "../common/FadeText.js";
import "./ConfirmDialog.css";

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  subject?: string;
  icon?: React.ReactNode;
  tone?: "default" | "danger";
  initialFocus?: "confirm" | "cancel";
  returnFocus?: HTMLElement | null;
  busy?: boolean;
  busyLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  subject,
  icon,
  tone = "default",
  initialFocus = "confirm",
  returnFocus,
  busy = false,
  busyLabel,
  confirmLabel = "Archive",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const fallbackReturnFocusRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );

  // Mounted ⇒ open. Claim ESC so a background streaming session isn't
  // aborted (the dialog's key handler cancels this surface instead).
  useEscapeClaim(true);

  useLayoutEffect(() => {
    const target = initialFocus === "cancel" ? cancelRef.current : confirmRef.current;
    target?.focus();
  }, [initialFocus]);

  const cancel = (): void => {
    if (busy) return;
    const target = returnFocus ?? fallbackReturnFocusRef.current;
    onCancel();
    if (!target?.isConnected) return;
    const restore = (): void => {
      if (target.isConnected) target.focus();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
    else queueMicrotask(restore);
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== "Tab") return;

    const first = cancelRef.current;
    const last = confirmRef.current;
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="confirm-dialog-scrim"
      onClick={cancel}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
    >
      <div
        className={`confirm-dialog confirm-dialog--${tone}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        aria-busy={busy}
      >
        <div className="confirm-dialog__header">
          {icon && <div className="confirm-dialog__icon">{icon}</div>}
          <div className="confirm-dialog__heading">
            <div className="confirm-dialog__title" id={titleId}>
              {title}
            </div>
            {subject && (
              <FadeText className="confirm-dialog__subject" title={subject}>
                {subject}
              </FadeText>
            )}
          </div>
        </div>
        <div className="confirm-dialog__message" id={messageId}>
          {message}
        </div>
        <div className="confirm-dialog__actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--cancel"
            onClick={cancel}
            autoFocus={initialFocus === "cancel"}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--confirm"
            onClick={onConfirm}
            autoFocus={initialFocus === "confirm"}
            disabled={busy}
          >
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
