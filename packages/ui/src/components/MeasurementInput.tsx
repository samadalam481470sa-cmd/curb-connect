'use client';

import { useId, useState, type ComponentPropsWithoutRef } from 'react';
import {
  LENGTH_UNITS,
  LENGTH_UNIT_NAMES,
  formatLength,
  parseNonNegativeDecimal,
  toMeters,
  type CanonicalLength,
  type LengthUnit,
} from '../format/length';
import { ErrorIcon } from '../icons';
import { cx } from '../internal/cx';
import { useControllableState } from '../internal/useControllableState';
import { VisuallyHidden } from '../VisuallyHidden';
import { useFieldControl } from './Field';

export interface MeasurementInputProps extends Omit<
  ComponentPropsWithoutRef<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'prefix' | 'min' | 'max'
> {
  /**
   * Canonical value in metres, `{ state: 'unknown' }` when the person marked it unknown, or
   * `null` when nothing has been entered yet. Unknown is never the same as zero.
   */
  value: CanonicalLength | null;
  onChange: (value: CanonicalLength | null) => void;
  /** Display unit (controlled). The canonical value does not change when the unit changes. */
  unit?: LengthUnit;
  defaultUnit?: LengthUnit;
  onUnitChange?: (unit: LengthUnit) => void;
  units?: readonly LengthUnit[];
  /** Offer the explicit "Unknown" state (default true). */
  allowUnknown?: boolean;
  unknownLabel?: string;
}

/**
 * Length input (PLT-012, CURB-0xx). Emits a canonical SI value in metres; the ft / in / m toggle
 * only changes how the number is shown and typed. "Unknown" is a separate, explicit state so a
 * missing buried thickness or clearance is never silently treated as 0.
 */
export function MeasurementInput({
  value,
  onChange,
  unit,
  defaultUnit = 'ft',
  onUnitChange,
  units = LENGTH_UNITS,
  allowUnknown = true,
  unknownLabel = 'Unknown',
  className,
  onFocus,
  onBlur,
  ...props
}: MeasurementInputProps) {
  const generated = useId();
  const [displayUnit, setDisplayUnit] = useControllableState(unit, defaultUnit, onUnitChange);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const isUnknown = value?.state === 'unknown';
  const unitId = `fl-measure-${generated}-unit`;
  const problemId = `fl-measure-${generated}-problem`;
  const wired = useFieldControl(
    {
      ...props,
      disabled: isUnknown || props.disabled,
      'aria-invalid': problem ? true : props['aria-invalid'],
    },
    `${unitId}${problem ? ` ${problemId}` : ''}`,
  );
  const groupDisabled = Boolean(props.disabled);

  const displayText =
    editingText ?? (value?.state === 'known' ? formatLength(value.value, displayUnit) : '');

  const handleText = (text: string) => {
    setEditingText(text);
    const result = parseNonNegativeDecimal(text);
    if (!result.ok) {
      setProblem(
        result.reason === 'negative'
          ? 'Enter a length of zero or more.'
          : 'Enter a number, like 12.5.',
      );
      return;
    }
    setProblem(null);
    onChange(
      result.value === null
        ? null
        : { state: 'known', value: toMeters(result.value, displayUnit), unit: 'm' },
    );
  };

  return (
    <div className={cx('fl-measure', isUnknown && 'fl-measure--unknown', className)}>
      <div className="fl-measure__row">
        <div
          className={cx('fl-input-group', wired.disabled && 'fl-input-group--disabled')}
          data-invalid={wired['aria-invalid'] ? 'true' : undefined}
        >
          <input
            {...wired}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            className="fl-input fl-input--numeric"
            value={isUnknown ? '' : displayText}
            placeholder={isUnknown ? unknownLabel : props.placeholder}
            onFocus={onFocus}
            onChange={(event) => handleText(event.target.value)}
            onBlur={(event) => {
              if (!problem) setEditingText(null);
              onBlur?.(event);
            }}
          />
          <span className="fl-input-group__adornment" aria-hidden="true">
            {isUnknown ? '' : LENGTH_UNIT_NAMES[displayUnit].short}
          </span>
        </div>
        <div className="fl-segmented" role="group" aria-label="Unit">
          {units.map((u) => (
            <button
              key={u}
              type="button"
              className="fl-segmented__item"
              aria-pressed={u === displayUnit}
              disabled={groupDisabled || isUnknown}
              onClick={() => {
                setEditingText(null);
                setProblem(null);
                setDisplayUnit(u);
              }}
            >
              <span aria-hidden="true">{LENGTH_UNIT_NAMES[u].short}</span>
              <VisuallyHidden>{LENGTH_UNIT_NAMES[u].long}</VisuallyHidden>
            </button>
          ))}
        </div>
      </div>
      {allowUnknown && (
        <label className="fl-check fl-measure__unknown">
          <input
            type="checkbox"
            className="fl-check__input"
            checked={isUnknown}
            disabled={groupDisabled}
            onChange={(event) => {
              setEditingText(null);
              setProblem(null);
              onChange(event.target.checked ? { state: 'unknown' } : null);
            }}
          />
          <span className="fl-check__label">{unknownLabel}</span>
        </label>
      )}
      <VisuallyHidden id={unitId}>
        {isUnknown ? 'Value marked unknown' : `Length in ${LENGTH_UNIT_NAMES[displayUnit].long}`}
      </VisuallyHidden>
      {problem && (
        <p className="fl-field__error" id={problemId}>
          <ErrorIcon size={16} />
          {problem}
        </p>
      )}
    </div>
  );
}
