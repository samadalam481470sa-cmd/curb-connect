'use client';

import { useId, type ComponentPropsWithRef, type MouseEvent, type ReactNode } from 'react';
import { LockIcon, SpinnerIcon } from '../icons';
import { cx, joinIds } from '../internal/cx';
import { VisuallyHidden } from '../VisuallyHidden';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'disabled'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Work in progress (e.g. a submit in flight). The button stays focusable and announces
   * `aria-busy`, and clicks are ignored so a double tap cannot submit twice.
   */
  loading?: boolean;
  /** Screen-reader text while loading. Defaults to "Working". */
  loadingLabel?: string;
  /** Natively disabled: removed from the tab order. Prefer `deniedReason` when access is the issue. */
  disabled?: boolean;
  /**
   * Permission-denied variant: the action exists but the viewer's role or plan does not allow it.
   * The button stays focusable, shows a lock and exposes the reason as its description.
   * The server still enforces the permission; this is only the visible explanation.
   */
  deniedReason?: string;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel = 'Working',
  disabled = false,
  deniedReason,
  iconStart,
  iconEnd,
  fullWidth = false,
  type = 'button',
  className,
  children,
  onClick,
  'aria-describedby': describedBy,
  ...props
}: ButtonProps) {
  const reasonId = useId();
  const denied = deniedReason !== undefined && deniedReason.length > 0;
  const inert = loading || denied;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (inert) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      aria-describedby={joinIds(describedBy, denied && reasonId)}
      data-state={loading ? 'loading' : denied ? 'denied' : disabled ? 'disabled' : undefined}
      className={cx(
        'fl-btn',
        `fl-btn--${variant}`,
        `fl-btn--${size}`,
        fullWidth && 'fl-btn--full',
        className,
      )}
      onClick={handleClick}
    >
      {loading ? (
        <SpinnerIcon className="fl-btn__icon" />
      ) : denied ? (
        <LockIcon className="fl-btn__icon" />
      ) : (
        iconStart && <span className="fl-btn__icon">{iconStart}</span>
      )}
      <span className="fl-btn__label">{children}</span>
      {!loading && !denied && iconEnd && <span className="fl-btn__icon">{iconEnd}</span>}
      {loading && <VisuallyHidden>{`, ${loadingLabel}`}</VisuallyHidden>}
      {denied && <VisuallyHidden id={reasonId}>{`Not available: ${deniedReason}`}</VisuallyHidden>}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'iconStart' | 'iconEnd'> {
  /** Accessible name. Required because the button has no visible text. */
  label: string;
  icon: ReactNode;
}

/** Icon-only button. `label` becomes the accessible name and the hover tooltip. */
export function IconButton({
  label,
  icon,
  className,
  variant = 'ghost',
  ...props
}: IconButtonProps) {
  return (
    <Button
      {...props}
      variant={variant}
      aria-label={label}
      title={props.title ?? label}
      className={cx('fl-btn--icon', className)}
    >
      <span className="fl-btn__glyph" aria-hidden="true">
        {icon}
      </span>
    </Button>
  );
}
