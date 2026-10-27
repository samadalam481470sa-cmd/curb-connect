'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../internal/cx';
import { useFieldControl } from './Field';

export interface TextInputProps extends Omit<ComponentPropsWithRef<'input'>, 'prefix'> {
  /** Non-interactive text before the value, e.g. a currency symbol. Hidden from screen readers. */
  prefix?: ReactNode;
  /** Non-interactive text after the value, e.g. a unit. Hidden from screen readers. */
  suffix?: ReactNode;
  /** Shows a busy indicator, e.g. while an address lookup runs. */
  loading?: boolean;
}

/**
 * Single-line text input. Put it inside a <Field> for its label, hint and error. Adornments are
 * decorative: put the unit or currency in the Field label or hint so it is announced.
 */
export function TextInput({
  prefix,
  suffix,
  loading = false,
  className,
  type = 'text',
  ...props
}: TextInputProps) {
  const wired = useFieldControl(props);
  const input = (
    <input
      {...wired}
      type={type}
      aria-busy={loading || undefined}
      className={cx('fl-input', !prefix && !suffix && className)}
    />
  );
  if (!prefix && !suffix && !loading) return input;
  return (
    <div
      className={cx('fl-input-group', wired.disabled && 'fl-input-group--disabled', className)}
      data-invalid={wired['aria-invalid'] ? 'true' : undefined}
    >
      {prefix && (
        <span className="fl-input-group__adornment" aria-hidden="true">
          {prefix}
        </span>
      )}
      {input}
      {suffix && (
        <span className="fl-input-group__adornment" aria-hidden="true">
          {suffix}
        </span>
      )}
      {loading && <span className="fl-input-group__spinner" aria-hidden="true" />}
    </div>
  );
}
