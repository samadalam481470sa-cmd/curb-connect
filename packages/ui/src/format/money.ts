/**
 * PLT-019 / CP-051: money at the UI boundary. Values are integer minor units (bigint) plus an ISO
 * 4217 currency. Parsing and formatting work on decimal strings, never on JS floats, so what the
 * user typed is exactly what is stored (ADR 0005).
 */

const fractionDigitsCache = new Map<string, number>();

/** Minor-unit digits for a currency (USD 2, JPY 0, KWD 3), from the runtime's ISO 4217 data. */
export function currencyFractionDigits(currency: string): number {
  const key = currency.toUpperCase();
  let digits = fractionDigitsCache.get(key);
  if (digits === undefined) {
    digits =
      new Intl.NumberFormat('en-US', { style: 'currency', currency: key }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    fractionDigitsCache.set(key, digits);
  }
  return digits;
}

export interface LocaleSeparators {
  decimal: string;
  group: string;
}

/** Decimal and grouping separators for a locale, e.g. en-US "." and ",", de-DE "," and ".". */
export function localeSeparators(locale: string): LocaleSeparators {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
  return {
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
  };
}

/** Where the currency symbol sits for a locale, and what it is (e.g. "$", "CA$", "€"). */
export function currencyAffix(
  currency: string,
  locale: string,
): { symbol: string; position: 'prefix' | 'suffix' } {
  const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(1);
  const symbolIndex = parts.findIndex((p) => p.type === 'currency');
  const integerIndex = parts.findIndex((p) => p.type === 'integer');
  return {
    symbol: parts[symbolIndex]?.value ?? currency,
    position: symbolIndex > integerIndex ? 'suffix' : 'prefix',
  };
}

function splitMinor(
  minor: bigint,
  digits: number,
): { negative: boolean; whole: string; frac: string } {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const scale = 10n ** BigInt(digits);
  return {
    negative,
    whole: (abs / scale).toString(),
    frac: digits > 0 ? (abs % scale).toString().padStart(digits, '0') : '',
  };
}

/** Minor units as a plain decimal string with a "." separator, e.g. 549120n USD -> "5491.20". */
export function minorToDecimalString(minor: bigint, currency: string): string {
  const { negative, whole, frac } = splitMinor(minor, currencyFractionDigits(currency));
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * Formats minor units for display, e.g. 549120n USD en-US -> "$5,491.20". Intl formats the exact
 * decimal string (no float conversion). `symbol: false` gives "5,491.20" for inputs with an affix.
 */
export function formatMinorUnits(
  minor: bigint,
  currency: string,
  locale = 'en-US',
  options: { symbol?: boolean } = {},
): string {
  const digits = currencyFractionDigits(currency);
  const formatter = new Intl.NumberFormat(locale, {
    style: options.symbol === false ? 'decimal' : 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return formatter.format(minorToDecimalString(minor, currency) as Intl.StringNumericLiteral);
}

/** Editable text for a value: locale decimal separator, no grouping, e.g. "5491,20" in de-DE. */
export function minorToEditableText(minor: bigint, currency: string, locale = 'en-US'): string {
  const { negative, whole, frac } = splitMinor(minor, currencyFractionDigits(currency));
  const { decimal } = localeSeparators(locale);
  return `${negative ? '-' : ''}${whole}${frac ? `${decimal}${frac}` : ''}`;
}

export type MoneyParseResult =
  | { ok: true; minor: bigint | null }
  | { ok: false; reason: 'invalid' | 'too_many_decimals' | 'negative' };

/**
 * Parses what a person typed into minor units. Empty input is `null` (no value), never 0.
 * Accepts the locale's grouping and decimal separators and an optional currency symbol. Rejects,
 * rather than rounds, more decimals than the currency has.
 */
export function parseMoneyInput(
  text: string,
  currency: string,
  locale = 'en-US',
  options: { allowNegative?: boolean } = {},
): MoneyParseResult {
  const digits = currencyFractionDigits(currency);
  const { decimal, group } = localeSeparators(locale);
  let cleaned = text.replace(/[\s\u00a0\u202f]/g, '');
  if (cleaned.length === 0) return { ok: true, minor: null };
  cleaned = cleaned.replace(/\u2212/g, '-');
  if (group) cleaned = cleaned.split(group).join('');
  // Drop a currency symbol or code typed by the user ("$", "US$", "EUR").
  cleaned = cleaned.replace(/[^\d\-.,]/g, '');
  if (decimal !== '.') {
    if (cleaned.includes('.')) return { ok: false, reason: 'invalid' };
    cleaned = cleaned.split(decimal).join('.');
  } else if (cleaned.includes(',')) {
    return { ok: false, reason: 'invalid' };
  }
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return { ok: false, reason: 'invalid' };
  const [, sign = '', whole = '', frac = ''] = match;
  if (whole.length === 0 && frac.length === 0) return { ok: false, reason: 'invalid' };
  if (frac.length > digits) return { ok: false, reason: 'too_many_decimals' };
  if (sign === '-' && !options.allowNegative) return { ok: false, reason: 'negative' };
  const scale = 10n ** BigInt(digits);
  const minorAbs = BigInt(whole || '0') * scale + BigInt((frac || '').padEnd(digits, '0') || '0');
  return { ok: true, minor: sign === '-' ? -minorAbs : minorAbs };
}
