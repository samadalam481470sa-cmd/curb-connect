'use client';

import { useEffect, useId, useRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { ErrorIcon } from '../icons';
import { cx, joinIds } from '../internal/cx';
import { VisuallyHidden } from '../VisuallyHidden';

export interface CheckboxProps extends Omit<ComponentPropsWithoutRef<'input'>, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Mixed state, e.g. "some rows selected". Announced as "mixed". */
  indeterminate?: boolean;
}

/** Checkbox with its own label, hint and error (a checkbox labels itself, so no <Field>). */
export function Checkbox({
  label,
  hint,
  error,
  indeterminate = false,
  id,
  className,
  'aria-describedby': describedBy,
  ...props
}: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? `fl-check-${generated}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className={cx('fl-check', error ? 'fl-check--invalid' : undefined, className)}>
      <input
        {...props}
        ref={ref}
        id={inputId}
        type="checkbox"
        className="fl-check__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={joinIds(hintId, errorId, describedBy)}
      />
      <div className="fl-check__text">
        <label className="fl-check__label" htmlFor={inputId}>
          {label}
        </label>
        {hint && (
          <p className="fl-field__hint" id={hintId}>
            {hint}
          </p>
        )}
        {error && (
          <p className="fl-field__error" id={errorId}>
            <ErrorIcon size={16} />
            <VisuallyHidden>Error: </VisuallyHidden>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
