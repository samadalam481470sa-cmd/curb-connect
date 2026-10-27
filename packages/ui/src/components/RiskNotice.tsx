import { useId, type ReactNode } from 'react';
import { AlertIcon, ErrorIcon, InfoIcon } from '../icons';
import { cx } from '../internal/cx';

export const RISK_KINDS = [
  'permit',
  'utility',
  'right_of_way',
  'preliminary_quote',
  'calibration',
  'depth',
  'imagery_rights',
  'site_safety',
] as const;
export type RiskKind = (typeof RISK_KINDS)[number];

export type RiskSeverity = 'info' | 'warning' | 'danger';

export const RISK_DEFAULTS: Record<RiskKind, { title: string; severity: RiskSeverity }> = {
  permit: { title: 'Permit status not confirmed', severity: 'warning' },
  utility: { title: 'Utility clearance not verified', severity: 'danger' },
  right_of_way: { title: 'Work in the public right-of-way', severity: 'warning' },
  preliminary_quote: {
    title: 'Preliminary budgetary range, not a binding quote',
    severity: 'warning',
  },
  calibration: { title: 'Calibration required before measuring', severity: 'warning' },
  depth: { title: 'Depth and reinforcement not verified', severity: 'warning' },
  imagery_rights: { title: 'Imagery not licensed for this use', severity: 'info' },
  site_safety: { title: 'Site safety prerequisites incomplete', severity: 'danger' },
};

export interface RiskNoticeProps {
  kind: RiskKind;
  /** Overrides the default title for the kind. */
  title?: string;
  severity?: RiskSeverity;
  /** What is unresolved and what to do next. */
  children?: ReactNode;
  /** A next-step control, e.g. "Add permit details". */
  action?: ReactNode;
  /** Pin to the top of the scroll area so it stays visible on long capture screens. */
  sticky?: boolean;
  /**
   * Announce immediately (role="alert"). Use when the risk appears in response to a user action;
   * leave off for notices present on page load (role="note"), which are read in document order.
   */
  announce?: boolean;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/**
 * PLT-012-S / CP-056 / CV-049: a risk notice (permit, utility, right-of-way, preliminary quote,
 * calibration...). By design it has no dismiss control and no "hide" prop: an unresolved risk is
 * removed only when the underlying condition is resolved. It stacks above floating controls
 * (`--fl-z-risk` > `--fl-z-floating`) and reserves its own space in the flow, so a dense mobile
 * capture screen cannot cover it.
 */
export function RiskNotice({
  kind,
  title,
  severity,
  children,
  action,
  sticky = false,
  announce = false,
  headingLevel = 3,
  className,
}: RiskNoticeProps) {
  const titleId = useId();
  const defaults = RISK_DEFAULTS[kind];
  const effectiveSeverity = severity ?? defaults.severity;
  const Heading = `h${headingLevel}` as const;
  const icon =
    effectiveSeverity === 'danger' ? (
      <ErrorIcon />
    ) : effectiveSeverity === 'warning' ? (
      <AlertIcon />
    ) : (
      <InfoIcon />
    );
  return (
    <div
      role={announce ? 'alert' : 'note'}
      aria-labelledby={titleId}
      className={cx(
        'fl-risk',
        `fl-risk--${effectiveSeverity}`,
        sticky && 'fl-risk--sticky',
        className,
      )}
      data-risk-kind={kind}
    >
      <span className="fl-risk__icon">{icon}</span>
      <div className="fl-risk__body">
        <Heading className="fl-risk__title" id={titleId}>
          {title ?? defaults.title}
        </Heading>
        {children && <div className="fl-risk__detail">{children}</div>}
        {action && <div className="fl-risk__action">{action}</div>}
      </div>
    </div>
  );
}
