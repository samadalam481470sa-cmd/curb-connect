'use client';

import { useId, type ReactNode } from 'react';
import { ErrorIcon } from '../icons';
import { cx, joinIds } from '../internal/cx';
import { useControllableState } from '../internal/useControllableState';
import { VisuallyHidden } from '../VisuallyHidden';

export interface RadioOption<V extends string = string> {
  value: V;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string = string> {
  legend: ReactNode;
  options: ReadonlyArray<RadioOption<V>>;
  /** Controlled value. `null` means nothing chosen yet (never silently defaulted). */
  value?: V | null;
  defaultValue?: V | null;
  onChange?: (value: V) => void;
  name?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  orientation?: 'vertical' | 'horizontal';
  legendHidden?: boolean;
  className?: string;
}

/**
 * Native radio buttons in a fieldset. Browsers provide arrow-key movement within the group and a
 * single tab stop; the legend names the group. Typed answers with an explicit "Unknown" option
 * (CV-042-D: observations are not unchecked booleans) are built from this.
 */
export function RadioGroup<V extends string = string>({
  legend,
  options,
  value,
  defaultValue = null,
  onChange,
  name,
  hint,
  error,
  required = false,
  disabled = false,
  orientation = 'vertical',
  legendHidden = false,
  className,
}: RadioGroupProps<V>) {
  const generated = useId();
  const groupName = name ?? `fl-radio-${generated}`;
  const hintId = hint ? `${groupName}-hint` : undefined;
  const errorId = error ? `${groupName}-error` : undefined;
  const [current, setCurrent] = useControllableState<V | null>(value, defaultValue, (next) => {
    if (next !== null) onChange?.(next);
  });

  return (
    <fieldset
      className={cx('fl-radio-group', `fl-radio-group--${orientation}`, className)}
      aria-describedby={joinIds(hintId, errorId)}
      aria-invalid={error ? true : undefined}
      aria-required={required || undefined}
      disabled={disabled}
    >
      <legend className="fl-field__label">
        {legendHidden ? <VisuallyHidden>{legend}</VisuallyHidden> : legend}
        {required && (
          <>
            <span className="fl-field__required" aria-hidden="true">
              {' *'}
            </span>
            <VisuallyHidden> (required)</VisuallyHidden>
          </>
        )}
      </legend>
      {hint && (
        <p className="fl-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      <div className="fl-radio-group__options">
        {options.map((option) => {
          const optionId = `${groupName}-${option.value}`;
          const optionHintId = option.hint ? `${optionId}-hint` : undefined;
          return (
            <div className="fl-check" key={option.value}>
              <input
                type="radio"
                className="fl-check__input fl-check__input--radio"
                id={optionId}
                name={groupName}
                value={option.value}
                checked={current === option.value}
                disabled={option.disabled}
                required={required}
                aria-describedby={optionHintId}
                onChange={() => setCurrent(option.value)}
              />
              <div className="fl-check__text">
                <label className="fl-check__label" htmlFor={optionId}>
                  {option.label}
                </label>
                {option.hint && (
                  <p className="fl-field__hint" id={optionHintId}>
                    {option.hint}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <p className="fl-field__error" id={errorId}>
          <ErrorIcon size={16} />
          <VisuallyHidden>Error: </VisuallyHidden>
          {error}
        </p>
      )}
    </fieldset>
  );
}
