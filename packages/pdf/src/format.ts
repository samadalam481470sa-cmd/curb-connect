import type { EdgeCategory, Known, MeasurementSystem, Money, ProvenanceSource } from './snapshots';

const FRACTION_DIGITS: Record<string, number> = { JPY: 0, KRW: 0, BHD: 3, KWD: 3, OMR: 3 };
const SYMBOLS: Record<string, string> = { USD: '$', CAD: 'CA$', EUR: '€', GBP: '£', AUD: 'A$' };

/** Formats integer minor units exactly (integer math only, no floating point). */
export function formatMoney(m: Money): string {
  if (!Number.isSafeInteger(m.amountMinor))
    throw new RangeError('amountMinor must be a safe integer');
  const digits = FRACTION_DIGITS[m.currency] ?? 2;
  const negative = m.amountMinor < 0;
  const abs = BigInt(Math.abs(m.amountMinor));
  const scale = 10n ** BigInt(digits);
  const whole = (abs / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = digits > 0 ? `.${(abs % scale).toString().padStart(digits, '0')}` : '';
  const symbol = SYMBOLS[m.currency];
  const body = symbol ? `${symbol}${whole}${frac}` : `${whole}${frac} ${m.currency}`;
  return negative ? `-${body}` : body;
}

/** Round half away from zero to `digits` decimals, returned as fixed text. */
export function fixed(value: number, digits: number): string {
  const f = 10 ** digits;
  const r = (Math.sign(value) * Math.round(Math.abs(value) * f + 1e-9)) / f;
  return (Object.is(r, -0) ? 0 : r).toFixed(digits);
}

function group(text: string): string {
  const [w, f] = text.split('.');
  const g = w!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return f === undefined ? g : `${g}.${f}`;
}

const SQ_FT_PER_SQ_M = 1 / (0.3048 * 0.3048);
const FT_PER_M = 1 / 0.3048;

export function formatArea(sqM: number, system: MeasurementSystem): string {
  return system === 'imperial'
    ? `${group(fixed(sqM * SQ_FT_PER_SQ_M, 0))} sq ft`
    : `${group(fixed(sqM, 1))} m²`;
}

/** Roofing squares (1 square = 100 sq ft), exact to two decimals; packs are rounded elsewhere. */
export function formatSquares(sqM: number): string {
  return `${fixed((sqM * SQ_FT_PER_SQ_M) / 100, 2)} sq`;
}

export function formatLength(m: number, system: MeasurementSystem): string {
  return system === 'imperial' ? `${group(fixed(m * FT_PER_M, 1))} ft` : `${group(fixed(m, 2))} m`;
}

export function formatKnown<T>(k: Known<T>, f: (v: T) => string): string {
  return k.state === 'known' ? f(k.value) : `Unknown${k.reason ? ` (${k.reason})` : ''}`;
}

export function formatPitch(risePer12: number): string {
  return `${fixed(risePer12, risePer12 % 1 === 0 ? 0 : 1)}/12`;
}

/** Fixed-format UTC-or-zone date so output never depends on the host locale. */
export function formatDate(iso: string, timeZone = 'UTC'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d);
}

export function formatDateTime(iso: string, timeZone = 'UTC'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(d);
  return text;
}

export const PROVENANCE_LABEL: Record<ProvenanceSource, string> = {
  machine_estimated: 'Estimated (machine)',
  imagery_derived: 'Estimated (imagery)',
  user_entered: 'User entered',
  field_verified: 'Field verified',
  survey_supplied: 'Survey supplied',
};

/** Measured = a person or a survey verified it; everything else is an estimate. */
export function isMeasured(p: ProvenanceSource): boolean {
  return p === 'field_verified' || p === 'survey_supplied' || p === 'user_entered';
}

export const EDGE_LABEL: Record<EdgeCategory, string> = {
  ridge: 'Ridge',
  hip: 'Hip',
  valley: 'Valley',
  rake: 'Rake',
  eave: 'Eave',
  step_flashing: 'Step flashing',
  wall_flashing: 'Wall flashing',
  drip_edge: 'Drip edge',
  parapet: 'Parapet',
  transition: 'Transition',
  unclassified: 'Unclassified',
};

export const EDGE_ORDER: EdgeCategory[] = Object.keys(EDGE_LABEL) as EdgeCategory[];

/** Stable ordering helper: sorts by key with a deterministic tie-break on id. */
export function stableSort<T>(
  items: readonly T[],
  key: (t: T) => string | number,
  id: (t: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    const ia = id(a);
    const ib = id(b);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}
