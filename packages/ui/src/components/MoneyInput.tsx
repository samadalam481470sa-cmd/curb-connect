'use client';

import { useId, useState, type ComponentPropsWithoutRef } from 'react';
import {
  currencyAffix,
  formatMinorUnits,
  minorToEditableText,
  parseMoneyInput,
  type MoneyParseResult,
} from '../format/money';
import { ErrorIcon } from '../icons';
import { cx } from '../internal/cx';
import { VisuallyHidden } from '../VisuallyHidden';
import { useFieldControl } from './Field';

export interface MoneyInputProps extends Omit<
  ComponentPropsWithoutRef<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'prefix' | 'min' | 'max'
> {
  /** Integer minor units (cents for USD). `null` = no amount entered, which is not zero. */
  valueMinor: bigint | null;
  /** Fires only with a valid amount (or `null` when cleared). Invalid text is reported inline. */
  onChangeMinor: (valueMinor: bigint | null) => void;
  /** ISO 4217 code; decides the symbol and how many decimals are allowed. */
  currency: string;
  /** Formatting locale (separators, symbol position). Defaults to en-US. */
  locale?: string;
  allowNegative?: boolean;
  minMinor?: bigint;
  maxMinor?: bigint;
}

function describeProblem(
  result: Exclude<MoneyParseResult, { ok: true }>['reason'] | 'below_min' | 'above_max',
  currency: string,
  locale: string,
  minMinor?: bigint,
  maxMinor?: bigint,
): string {
  switch (result) {
    case 'too_many_decimals':
      return `Use no more decimal places than ${currency} allows.`;
    case 'negative':
      return 'Enter an amount of zero or more.';
    case 'below_min':
      return `Enter at least ${formatMinorUnits(minMinor ?? 0n, currency, locale)}.`;
    case 'above_max':
      return `Enter at most ${formatMinorUnits(maxMinor ?? 0n, currency, locale)}.`;
    default:
      return `Enter an amount like ${formatMinorUnits(125000n, currency, locale, { symbol: false })}.`;
  }
}

/**
 * Currency-aware amount input (CP-051 / OPS-065). Takes and emits integer minor units, so the
 * value never passes through floating point. Shows grouped digits when idle and plain digits while
 * editing; rejects (does not round) extra decimals.
 */
export function MoneyInput({
  valueMinor,
  onChangeMinor,
  currency,
  locale = 'en-US',
  allowNegative = false,
  minMinor,
  maxMinor,
  className,
  onFocus,
  onBlur,
  ...props
}: MoneyInputProps) {
  const generated = useId();
  const [editingText, setEditingText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = `fl-money-${generated}-problem`;
  const currencyId = `fl-money-${generated}-currency`;
  const wired = useFieldControl(
    { ...props, 'aria-invalid': problem ? true : props['aria-invalid'] },
    `${currencyId}${problem ? ` ${problemId}` : ''}`,
  );
  const affix = currencyAffix(currency, locale);

  const displayText =
    editingText ??
    (valueMinor === null ? '' : formatMinorUnits(valueMinor, currency, locale, { symbol: false }));

  const handleText = (text: string) => {
    setEditingText(text);
    const result = parseMoneyInput(text, currency, locale, { allowNegative });
    if (!result.ok) {
      setProblem(describeProblem(result.reason, currency, locale));
      return;
    }
    if (result.minor !== null && minMinor !== undefined && result.minor < minMinor) {
      setProblem(describeProblem('below_min', currency, locale, minMinor, maxMinor));
      return;
    }
    if (result.minor !== null && maxMinor !== undefined && result.minor > maxMinor) {
      setProblem(describeProblem('above_max', currency, locale, minMinor, maxMinor));
      return;
    }
    setProblem(null);
    if (result.minor !== valueMinor) onChangeMinor(result.minor);
  };

  return (
    <div className={cx('fl-money', className)}>
      <div
        className={cx('fl-input-group', wired.disabled && 'fl-input-group--disabled')}
        data-invalid={wired['aria-invalid'] ? 'true' : undefined}
      >
        {affix.position === 'prefix' && (
          <span className="fl-input-group__adornment" aria-hidden="true">
            {affix.symbol}
          </span>
        )}
        <input
          {...wired}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          className="fl-input fl-input--numeric"
          value={displayText}
          onFocus={(event) => {
            if (editingText === null && valueMinor !== null) {
              setEditingText(minorToEditableText(valueMinor, currency, locale));
            }
            onFocus?.(event);
          }}
          onChange={(event) => handleText(event.target.value)}
          onBlur={(event) => {
            // Valid input snaps back to the formatted display; invalid text stays for correction.
            if (!problem) setEditingText(null);
            onBlur?.(event);
          }}
        />
        {affix.position === 'suffix' && (
          <span className="fl-input-group__adornment" aria-hidden="true">
            {affix.symbol}
          </span>
        )}
      </div>
      <VisuallyHidden id={currencyId}>{`Amount in ${currency.toUpperCase()}`}</VisuallyHidden>
      {problem && (
        <p className="fl-field__error" id={problemId}>
          <ErrorIcon size={16} />
          {problem}
        </p>
      )}
    </div>
  );
}
