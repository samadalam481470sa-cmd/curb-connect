'use client';

import { Button } from '@fieldline/ui';
import type { ReactNode } from 'react';
import { errorHint } from '../../lib/api';
import { AUTOSAVE_LABEL, type AutosaveState } from './model';

/** Shared autosave indicator (same states as the roof editor), announced politely. */
export function AutosaveStatus({ state, onRetry, onReload, error }: { state: AutosaveState; onRetry?: () => void; onReload?: () => void; error?: unknown }) {
  return (
    <div className="curb-autosave" data-state={state} role="status" aria-live="polite">
      <span className="curb-autosave__dot" aria-hidden="true" />
      <span>{AUTOSAVE_LABEL[state]}</span>
      {state === 'error' && error !== null && error !== undefined && <span className="web-muted"> {errorHint(error)}</span>}
      {(state === 'offline' || state === 'error') && onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
      {state === 'conflict' && onReload && (
        <Button size="sm" variant="secondary" onClick={onReload}>
          Load latest
        </Button>
      )}
    </div>
  );
}

export function Panel({ title, children, actions, id }: { title: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className="curb-panel" aria-labelledby={id ? `${id}-h` : undefined}>
      <header className="curb-panel__head">
        <h2 id={id ? `${id}-h` : undefined}>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}
