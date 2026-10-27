'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CloseIcon } from '../icons';
import { cx } from '../internal/cx';
import type { Tone } from '../types';
import { IconButton } from './Button';

export interface ToastInput {
  message: ReactNode;
  tone?: Tone;
  /** Milliseconds; `null` keeps it until dismissed. Errors default to sticky. */
  durationMs?: number | null;
  action?: { label: string; onAction: () => void };
}

interface ToastEntry extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Toast region + polite / assertive live regions. Toasts never carry the only copy of important
 * information (errors that block work belong inline next to the cause), and they stack above the
 * bottom navigation without covering risk notices (z-toast only overlaps transient UI).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { ...toast, id }]);
      const duration =
        toast.durationMs === undefined ? (toast.tone === 'danger' ? null : 6000) : toast.durationMs;
      if (duration !== null)
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  const polite = toasts.filter((t) => t.tone !== 'danger');
  const assertive = toasts.filter((t) => t.tone === 'danger');
  const render = (t: ToastEntry) => (
    <div key={t.id} className={cx('fl-toast', `fl-toast--${t.tone ?? 'neutral'}`)}>
      <div className="fl-toast__message">{t.message}</div>
      {t.action && (
        <button
          type="button"
          className="fl-toast__action"
          onClick={() => {
            t.action?.onAction();
            dismiss(t.id);
          }}
        >
          {t.action.label}
        </button>
      )}
      <IconButton
        size="sm"
        label="Dismiss notification"
        icon={<CloseIcon size={16} />}
        onClick={() => dismiss(t.id)}
      />
    </div>
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fl-toast-region" aria-label="Notifications" role="region">
        <div role="status" aria-live="polite" aria-atomic="false">
          {polite.map(render)}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="false">
          {assertive.map(render)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>.');
  return ctx;
}

/**
 * Visually hidden live region for announcing state changes that have no toast, e.g. "Facet 3
 * deleted" in the roof editor. Change `message` to announce it.
 */
export function LiveRegion({
  message,
  politeness = 'polite',
}: {
  message: string;
  politeness?: 'polite' | 'assertive';
}) {
  return (
    <div
      className="fl-visually-hidden"
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
    >
      {message}
    </div>
  );
}
