'use client';

import { Button, EmptyState, type ButtonProps } from '@fieldline/ui';
import { useId, type ReactNode } from 'react';
import { errorHint, isApiError } from '../lib/api';

/** Page heading. Route-change focus lands here (tabIndex -1), so it is the first thing read. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="web-page-header">
      <div>
        <h1 tabIndex={-1} data-route-heading="">
          {title}
        </h1>
        {description && <p className="web-muted">{description}</p>}
      </div>
      {actions && <div className="web-page-header__actions">{actions}</div>}
    </header>
  );
}

/**
 * Inline error for a failed request: tenant-free hint, retry when it may help, and the
 * correlation id support needs (BE-073). Announced with role="alert".
 */
export function ErrorNotice({
  error,
  title = 'Something went wrong',
  onRetry,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}) {
  const apiError = isApiError(error) ? error : null;
  return (
    <div className="web-error" role="alert">
      <p className="web-error__title">{apiError?.problem.title ?? title}</p>
      <p>{apiError?.problem.detail ?? errorHint(error)}</p>
      {apiError?.problem.errors && apiError.problem.errors.length > 0 && (
        <ul>
          {apiError.problem.errors.map((e) => (
            <li key={`${e.path}-${e.message}`}>
              {e.path ? `${e.path}: ` : ''}
              {e.message}
            </li>
          ))}
        </ul>
      )}
      {apiError && (
        <p className="web-muted web-small">
          Reference: <code>{apiError.correlationId}</code>
        </p>
      )}
      {onRetry && (apiError?.retryable ?? true) && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * A button the member may not be allowed to use. When denied it stays focusable, shows a lock and
 * a visible explanation instead of disappearing (PLT-015 A). The API still enforces the rule.
 */
export function GuardedButton({
  deniedReason,
  children,
  ...props
}: ButtonProps & { deniedReason?: string }) {
  const id = useId();
  if (!deniedReason) return <Button {...props}>{children}</Button>;
  return (
    <span className="web-guarded">
      <Button {...props} deniedReason={deniedReason} aria-describedby={id}>
        {children}
      </Button>
      <span id={id} className="web-denied-reason">
        {deniedReason}
      </span>
    </span>
  );
}

/** Honest placeholder for an area that is not built yet: never fake data (STR-005). */
export function ComingSoon({
  area,
  summary,
  requirementIds,
}: {
  area: string;
  summary: string;
  requirementIds: readonly string[];
}) {
  return (
    <EmptyState
      title={`${area} is coming in a later slice`}
      description={
        <>
          {summary} Nothing on this page is simulated: when the feature ships it will show your
          company&apos;s real records.{' '}
          <span className="web-muted web-small">Tracked as {requirementIds.join(', ')}.</span>
        </>
      }
      action={
        <a className="fl-btn fl-btn--secondary fl-btn--md" href="/">
          <span className="fl-btn__label">Back to Home</span>
        </a>
      }
    />
  );
}

/** Link styled as a button (for navigation, where a <button> would be the wrong element). */
export function ButtonLink({
  href,
  children,
  variant = 'primary',
  size = 'md',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <a className={`fl-btn fl-btn--${variant} fl-btn--${size}`} href={href}>
      <span className="fl-btn__label">{children}</span>
    </a>
  );
}
