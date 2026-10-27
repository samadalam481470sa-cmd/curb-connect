import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/** Focusable descendants in DOM order, skipping anything inside an inert or hidden subtree. */
export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) =>
      !el.closest('[inert]') && !el.closest('[hidden]') && !el.closest('[aria-hidden="true"]'),
  );
}

// Only the top-most open modal reacts to Escape/Tab, so a confirm dialog opened from a sheet
// closes alone.
const modalStack: symbol[] = [];

interface UseModalOptions {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Called on Escape. Omit to make Escape do nothing (e.g. while a confirm action is running). */
  onEscape?: () => void;
}

/**
 * Modal behaviour shared by ConfirmDialog and Sheet (WAI-ARIA dialog pattern):
 * - moves focus into the dialog on open and back to the previously focused element on close;
 * - traps Tab / Shift+Tab inside the dialog;
 * - Escape calls `onEscape`;
 * - makes everything outside the dialog `inert` so screen readers and pointer users cannot reach
 *   the page behind it, and locks body scroll.
 */
export function useModal({ open, containerRef, initialFocusRef, onEscape }: UseModalOptions) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;
    const id = Symbol('modal');
    modalStack.push(id);
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const portalRoot = container.closest<HTMLElement>('[data-fl-portal]') ?? container;
    const inerted: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === portalRoot || el.contains(portalRoot) || el.hasAttribute('inert')) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      el.setAttribute('inert', '');
      inerted.push(el);
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const target = initialFocusRef?.current ?? getFocusable(container)[0] ?? container;
    target.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const index = modalStack.indexOf(id);
      if (index >= 0) modalStack.splice(index, 1);
      for (const el of inerted) el.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [open, containerRef, initialFocusRef]);
}
