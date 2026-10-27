'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../internal/cx';
import { useModal } from '../internal/modal';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** What will happen, in plain words, including anything that cannot be undone. */
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` styles the confirm action for destructive or irreversible steps. */
  tone?: 'default' | 'danger';
  /** May return a promise; the dialog shows a busy state and blocks Escape until it settles. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  /** Shown as an alert inside the dialog, e.g. when the confirm request failed. */
  error?: ReactNode;
  /** Permission-denied variant: confirm is unavailable and the reason is announced. */
  deniedReason?: string;
}

/**
 * Modal confirmation (WAI-ARIA alertdialog). Focus moves to Cancel on open (the safe choice),
 * Tab is trapped, Escape cancels, and focus returns to the trigger on close.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
  error,
  deniedReason,
}: ConfirmDialogProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  useModal({
    open,
    containerRef,
    initialFocusRef: cancelRef,
    onEscape: busy ? undefined : onCancel,
  });
  if (!open || typeof document === 'undefined') return null;

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fl-overlay" data-fl-portal="">
      <div
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={cx('fl-dialog', tone === 'danger' && 'fl-dialog--danger')}
      >
        <h2 className="fl-dialog__title" id={`${id}-title`}>
          {title}
        </h2>
        {description && (
          <div className="fl-dialog__desc" id={`${id}-desc`}>
            {description}
          </div>
        )}
        {children}
        {error && (
          <div className="fl-dialog__error" role="alert">
            {error}
          </div>
        )}
        <div className="fl-dialog__actions">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            deniedReason={deniedReason}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
