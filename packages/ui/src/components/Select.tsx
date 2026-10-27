'use client';

import type { ComponentPropsWithRef } from 'react';
import { ChevronDownIcon } from '../icons';
import { cx } from '../internal/cx';
import { useFieldControl } from './Field';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends ComponentPropsWithRef<'select'> {
  options?: readonly SelectOption[];
  /**
   * Text of an empty first option (value ""). Use it so "nothing chosen yet" is explicit instead of
   * silently defaulting to the first real option.
   */
  placeholder?: string;
}

/** Native select: best keyboard, screen reader and mobile picker support. Use inside <Field>. */
export function Select({ options, placeholder, className, children, ...props }: SelectProps) {
  const wired = useFieldControl(props);
  return (
    <div className={cx('fl-select', className)}>
      <select {...wired} className="fl-select__control">
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDownIcon className="fl-select__chevron" size={18} />
    </div>
  );
}
