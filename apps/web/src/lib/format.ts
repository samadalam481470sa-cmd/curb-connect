// PLT-019: locale-aware display at the boundary. Stored values stay canonical: money in integer
// minor units + ISO currency, lengths in metres, areas in square metres, timestamps in UTC. These
// helpers only produce display strings and never feed a value back into storage.
import type { MeasurementSystem, Money } from '@fieldline/contracts';
import { formatMinorUnits } from '@fieldline/ui';

export function formatMoney(value: Money, locale: string): string {
  return formatMinorUnits(BigInt(value.amountMinor), value.currency, locale);
}

export function formatDateTime(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso));
}

export function formatDate(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(new Date(iso));
}

/** "5 minutes ago" style text for last-updated stamps (PLT-016 S). */
export function formatRelative(iso: string, locale: string, now: Date = new Date()): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return rtf.format(diffSeconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  return rtf.format(Math.round(diffSeconds / 86_400), 'day');
}

const FEET_PER_METRE = 1 / 0.3048;
const SQFT_PER_SQM = FEET_PER_METRE ** 2;

function number(value: number, locale: string, digits: number): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Display a canonical length (metres) in the preferred system. */
export function formatLengthDisplay(
  metres: number,
  system: MeasurementSystem,
  locale: string,
): string {
  return system === 'imperial'
    ? `${number(metres * FEET_PER_METRE, locale, 1)} ft`
    : `${number(metres, locale, 2)} m`;
}

/** Display a canonical area (square metres) in the preferred system. */
export function formatAreaDisplay(
  squareMetres: number,
  system: MeasurementSystem,
  locale: string,
): string {
  return system === 'imperial'
    ? `${number(squareMetres * SQFT_PER_SQM, locale, 0)} sq ft`
    : `${number(squareMetres, locale, 1)} m²`;
}
