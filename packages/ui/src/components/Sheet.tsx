'use client';

import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../icons';
import { cx } from '../internal/cx';
import { useModal } from '../internal/modal';
import { IconButton } from './Button';

export type SheetSide = 'right' | 'left' | 'bottom';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** `bottom` is the phone default for capture tools; `right` for desktop detail panes. */
  side?: SheetSide;
  footer?: ReactNode;
  closeLabel?: string;
  children: ReactNode;
}

/** Modal side or bottom sheet (Drawer). Same focus rules as ConfirmDialog. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  side = 'right',
  footer,
  closeLabel = 'Close',
  children,
}: SheetProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  useModal({ open, containerRef, onEscape: onClose });
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fl-overlay fl-overlay--sheet" data-fl-portal="">
      <div className="fl-overlay__scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={cx('fl-sheet', `fl-sheet--${side}`)}
      >
        <header className="fl-sheet__header">
          <h2 className="fl-sheet__title" id={`${id}-title`}>
            {title}
          </h2>
          <IconButton label={closeLabel} icon={<CloseIcon />} onClick={onClose} />
        </header>
        {description && (
          <p className="fl-sheet__desc" id={`${id}-desc`}>
            {description}
          </p>
        )}
        <div className="fl-sheet__body">{children}</div>
        {footer && <footer className="fl-sheet__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Alias: the blueprint calls the side variant a drawer. */
export const Drawer = Sheet;
