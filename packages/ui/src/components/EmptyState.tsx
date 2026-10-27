import type { ReactNode } from 'react';
import { ErrorIcon, InfoIcon, LockIcon } from '../icons';
import { cx } from '../internal/cx';
import type { ViewState } from '../types';
import { Button } from './Button';
import { Skeleton } from './Skeleton';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Primary next step, e.g. "Create first estimate". */
  action?: ReactNode;
  /** Heading level so the empty state fits the page outline. */
  headingLevel?: 2 | 3 | 4;
  tone?: 'neutral' | 'error' | 'denied';
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  headingLevel = 2,
  tone = 'neutral',
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  const fallbackIcon =
    tone === 'error' ? (
      <ErrorIcon size={32} />
    ) : tone === 'denied' ? (
      <LockIcon size={32} />
    ) : (
      <InfoIcon size={32} />
    );
  return (
    <div className={cx('fl-empty', `fl-empty--${tone}`, className)}>
      <span className="fl-empty__icon" aria-hidden="true">
        {icon ?? fallbackIcon}
      </span>
      <Heading className="fl-empty__title">{title}</Heading>
      {description && <p className="fl-empty__desc">{description}</p>}
      {action && <div className="fl-empty__action">{action}</div>}
    </div>
  );
}

export interface ViewStateBoundaryProps {
  state: ViewState;
  children: ReactNode;
  headingLevel?: 2 | 3 | 4;
}

/**
 * Renders the shared loading / empty / error / permission-denied variants (PLT-012) and the
 * children only when the state is `ready`. Errors are announced (role="alert") and show the
 * correlation id support needs.
 */
export function ViewStateBoundary({ state, children, headingLevel = 2 }: ViewStateBoundaryProps) {
  switch (state.status) {
    case 'ready':
      return <>{children}</>;
    case 'loading':
      return <Skeleton label={state.label ?? 'Loading'} />;
    case 'empty':
      return (
        <EmptyState
          title={state.title}
          description={state.description}
          headingLevel={headingLevel}
        />
      );
    case 'permission_denied':
      return (
        <EmptyState
          tone="denied"
          headingLevel={headingLevel}
          title={state.title ?? 'You do not have access to this'}
          description={state.message ?? 'Ask a workspace admin to change your role if you need it.'}
        />
      );
    case 'error':
      return (
        <div role="alert">
          <EmptyState
            tone="error"
            headingLevel={headingLevel}
            title={state.title ?? 'Something went wrong'}
            description={
              <>
                {state.message}
                {state.correlationId && (
                  <span className="fl-empty__ref">{` Reference: ${state.correlationId}`}</span>
                )}
              </>
            }
            action={
              state.onRetry && (
                <Button variant="secondary" onClick={state.onRetry}>
                  Try again
                </Button>
              )
            }
          />
        </div>
      );
  }
}
