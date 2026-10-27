'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';
import { ErrorIcon } from '../icons';
import { cx, joinIds } from '../internal/cx';
import { VisuallyHidden } from '../VisuallyHidden';

interface FieldContextValue {
  controlId: string;
  hintId?: string;
  errorId?: string;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  label: ReactNode;
  /** Persistent help text under the label (units, format, where to find the value). */
  hint?: ReactNode;
  /** Validation message. Its presence marks the control invalid and is announced with it. */
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** Visually hide the label (it stays the accessible name). Use sparingly. */
  labelHidden?: boolean;
  /** Override the generated control id. */
  id?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Label + hint + error wrapper. Controls rendered inside (TextInput, Select, MoneyInput,
 * MeasurementInput) pick up the id, `aria-describedby`, `aria-invalid` and `required` from it,
 * so every input is labelled and its help and errors are read with it (WCAG 1.3.1, 3.3.1, 3.3.2).
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  labelHidden = false,
  id,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? `fl-field-${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const invalid = Boolean(error);
  const labelContent = (
    <>
      {label}
      {required && (
        <>
          <span className="fl-field__required" aria-hidden="true">
            {' *'}
          </span>
          <VisuallyHidden> (required)</VisuallyHidden>
        </>
      )}
    </>
  );

  return (
    <FieldContext.Provider value={{ controlId, hintId, errorId, invalid, required, disabled }}>
      <div className={cx('fl-field', invalid && 'fl-field--invalid', className)}>
        <label className="fl-field__label" htmlFor={controlId} id={`${controlId}-label`}>
          {labelHidden ? <VisuallyHidden>{labelContent}</VisuallyHidden> : labelContent}
        </label>
        {hint && (
          <p className="fl-field__hint" id={hintId}>
            {hint}
          </p>
        )}
        {children}
        {error && (
          <p className="fl-field__error" id={errorId}>
            <ErrorIcon size={16} />
            <VisuallyHidden>Error: </VisuallyHidden>
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

export interface FieldControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
  required?: boolean;
  disabled?: boolean;
}

/** Merges a control's own props with the surrounding Field's wiring (own props win). */
export function useFieldControl<P extends FieldControlProps>(props: P, extraDescribedBy?: string) {
  const field = useContext(FieldContext);
  const invalidProp = props['aria-invalid'];
  const invalid = invalidProp === true || invalidProp === 'true' || Boolean(field?.invalid);
  return {
    ...props,
    id: props.id ?? field?.controlId,
    'aria-describedby': joinIds(
      field?.hintId,
      field?.errorId,
      props['aria-describedby'],
      extraDescribedBy,
    ),
    'aria-invalid': invalid || undefined,
    required: props.required ?? field?.required ?? undefined,
    disabled: props.disabled ?? field?.disabled ?? undefined,
  };
}

/** The label id of the surrounding Field, for composite controls that need aria-labelledby. */
export function useFieldLabelId(): string | undefined {
  const field = useContext(FieldContext);
  return field ? `${field.controlId}-label` : undefined;
}
