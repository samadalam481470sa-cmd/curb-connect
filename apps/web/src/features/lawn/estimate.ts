/** Lawn Care estimating core. Prices are editable illustrative presets, NOT live market quotes.
 * Satellite polygons are approximate and must not be represented as survey measurements.
 */
export type Schedule = 'one_time' | 'weekly' | 'biweekly' | 'monthly';
export type AreaSource = 'manual' | 'satellite';
export interface Coordinate { lon: number; lat: number }
export interface LawnSpec {
  customer: string;
  address: string;
  notes: string;
  areaSqFt: number;
  excludedSqFt: number;
  areaSource: AreaSource;
  schedule: Schedule;
  mow: boolean;
  edge: boolean;
  trim: boolean;
  blow: boolean;
  leaf: boolean;
  hedge: boolean;
  mulch: boolean;
  fertilize: boolean;
  aerate: boolean;
  seed: boolean;
  sod: boolean;
  mowPer1000: number;
  minimumMow: number;
  terrainFactor: number;
  edgingFeet: number;
  edgingRate: number;
  trimmingMinutes: number;
  hourlyRate: number;
  blowingFee: number;
  leafBags: number;
  leafBagRate: number;
  hedgeFeet: number;
  hedgeFootRate: number;
  mulchYards: number;
  mulchYardRate: number;
  fertilizerPer1000: number;
  aerationPer1000: number;
  seedingPer1000: number;
  sodSqFt: number;
  sodPerSqFt: number;
  tripFee: number;
  taxPercent: number;
  productivitySqFtHour: number;
}
export const DEFAULT_LAWN: LawnSpec = {
  customer: '', address: '', notes: '', areaSqFt: 6000, excludedSqFt: 0,
  areaSource: 'manual', schedule: 'biweekly',
  mow: true, edge: true, trim: true, blow: true,
  leaf: false, hedge: false, mulch: false, fertilize: false, aerate: false,
  seed: false, sod: false,
  mowPer1000: 8, minimumMow: 35, terrainFactor: 1,
  edgingFeet: 120, edgingRate: 0.15,
  trimmingMinutes: 15, hourlyRate: 35, blowingFee: 8,
  leafBags: 8, leafBagRate: 6, hedgeFeet: 50, hedgeFootRate: 2,
  mulchYards: 3, mulchYardRate: 65,
  fertilizerPer1000: 10, aerationPer1000: 12,
  seedingPer1000: 15, sodSqFt: 0, sodPerSqFt: 1,
  tripFee: 0, taxPercent: 0, productivitySqFtHour: 18000,
};
export const SCHEDULE_LABELS: Record<Schedule, string> = {
  one_time: 'One-time service', weekly: 'Weekly', biweekly: 'Every two weeks',
  monthly: 'Once per month',
};
export interface QuoteLine {
  id: string; label: string; qty: number; unit: string; unitPrice: number;
  amount: number; detail: string;
}
export interface LawnQuote {
  grossSqFt: number; netSqFt: number; acres: number; lines: QuoteLine[];
  subtotal: number; tax: number; perVisit: number;
  visitsPerMonth: number; monthlyProjection: number; annualProjection: number;
  estimatedCrewHours: number;
}
const moneyRound = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function safeNonnegative(value: unknown, max = 10_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, value));
}
const capped = (value: number, max: number) => safeNonnegative(value, max);
export function computeLawnQuote(spec: LawnSpec): LawnQuote {
  const grossSqFt = capped(spec.areaSqFt, 10_000_000);
  const netSqFt = Math.max(0, grossSqFt - capped(spec.excludedSqFt, 10_000_000));
  const lines: QuoteLine[] = [];
  const add = (id: string, label: string, qty: number, unit: string,
    unitPrice: number, detail: string) => {
    if (qty <= 0 || !Number.isFinite(qty)) return;
    const amount = moneyRound(qty * unitPrice);
    if (!Number.isFinite(amount) || amount < 0) return;
    lines.push({ id, label, qty, unit, unitPrice, amount, detail });
  };
  const perThousand = netSqFt / 1000;
  if (spec.mow && netSqFt > 0) {
    const factor = Math.min(3, Math.max(1, capped(spec.terrainFactor, 3)));
    const variable = moneyRound(perThousand * capped(spec.mowPer1000, 1000) * factor);
    const min = capped(spec.minimumMow, 100_000);
    add('mow', 'Grass mowing', 1, 'visit', Math.max(min, variable),
      `${Math.round(netSqFt).toLocaleString()} ft² × $/1,000 ft² × terrain factor ${factor}; minimum $ ${min}`);
  }
  if (spec.edge) add('edge', 'Sidewalk and driveway edging', capped(spec.edgingFeet, 100000),
    'linear ft', capped(spec.edgingRate, 1000), 'Verify edge length in the field');
  if (spec.trim) add('trim', 'String trimming around obstacles',
    capped(spec.trimmingMinutes, 10000) / 60, 'crew hr', capped(spec.hourlyRate, 500),
    'Editable time allowance');
  if (spec.blow) add('blow', 'Hardscape blowing', 1, 'visit', capped(spec.blowingFee, 100000),
    'Driveways, sidewalks and patios');
  if (spec.leaf) add('leaf', 'Leaf removal and bagging', capped(spec.leafBags, 10000),
    'bag', capped(spec.leafBagRate, 1000), 'Disposal fees may be additional');
  if (spec.hedge) add('hedge', 'Hedge trimming', capped(spec.hedgeFeet, 100000),
    'linear ft', capped(spec.hedgeFootRate, 1000), 'Height/access requires field check');
  if (spec.mulch) add('mulch', 'Mulch installation', capped(spec.mulchYards, 10000),
    'yd³', capped(spec.mulchYardRate, 1000), 'Confirm depth and delivered volume');
  if (spec.fertilize) add('fertilize', 'Lawn fertilization', perThousand,
    '1,000 ft²', capped(spec.fertilizerPer1000, 1000), 'Application rules vary by locality');
  if (spec.aerate) add('aerate', 'Core aeration', perThousand,
    '1,000 ft²', capped(spec.aerationPer1000, 1000), 'Check underground utilities and irrigation');
  if (spec.seed) add('seed', 'Overseeding', perThousand,
    '1,000 ft²', capped(spec.seedingPer1000, 1000), 'Seed type and application rate vary');
  if (spec.sod) add('sod', 'Sod installation', capped(spec.sodSqFt, 10_000_000),
    'ft²', capped(spec.sodPerSqFt, 1000), 'Includes only the entered unit rate; site prep extra');
  const tripFee = capped(spec.tripFee, 100000);
  if (tripFee > 0) add('travel', 'Trip / mobilization fee', 1,
    'visit', tripFee, 'Optional flat travel and equipment allowance');
  const subtotal = moneyRound(lines.reduce((sum, l) => sum + l.amount, 0));
  const tax = moneyRound(subtotal * capped(spec.taxPercent, 100) / 100);
  const perVisit = moneyRound(subtotal + tax);
  const visitsPerMonth = spec.schedule === 'weekly' ? 52 / 12 :
    spec.schedule === 'biweekly' ? 26 / 12 : 1;
  const annualProjection = spec.schedule === 'one_time' ? perVisit :
    moneyRound(perVisit * visitsPerMonth * 12);
  const monthlyProjection = spec.schedule === 'one_time' ? perVisit :
    moneyRound(perVisit * visitsPerMonth);
  const productivity = Math.max(1000, capped(spec.productivitySqFtHour, 100_000));
  return {
    grossSqFt, netSqFt, acres: moneyRound(netSqFt / 43560), lines, subtotal, tax,
    perVisit, visitsPerMonth, monthlyProjection, annualProjection,
    estimatedCrewHours: moneyRound(netSqFt / productivity +
      (spec.trim ? capped(spec.trimmingMinutes, 10000) / 60 : 0)),
  };
}

// Web Mercator-local projection for approximate lawn area, with shoelace geometry.
// Suitable only for planning, not a surveyed property/legal boundary.
const R = 6371008.8;
const RAD = Math.PI / 180;
function crosses(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  const dir = (p: Coordinate, q: Coordinate, v: Coordinate) =>
    (q.lon - p.lon) * (v.lat - p.lat) - (q.lat - p.lat) * (v.lon - p.lon);
  const one = dir(a, b, c), two = dir(a, b, d);
  const three = dir(c, d, a), four = dir(c, d, b);
  return ((one > 1e-12 && two < -1e-12) || (one < -1e-12 && two > 1e-12)) &&
    ((three > 1e-12 && four < -1e-12) || (three < -1e-12 && four > 1e-12));
}
export function polygonAreaSqFt(points: readonly Coordinate[]): number | null {
  if (points.length < 3 || points.length > 500) return null;
  if (points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon) ||
    p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180)) return null;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (crosses(points[i]!, points[(i + 1) % points.length]!,
        points[j]!, points[(j + 1) % points.length]!)) return null;
    }
  }
  const lat0 = points.reduce((n, p) => n + p.lat, 0) / points.length;
  const lon0 = points.reduce((n, p) => n + p.lon, 0) / points.length;
  let sum = 0;
  const xy = points.map(p => ({
    x: (p.lon - lon0) * RAD * R * Math.cos(lat0 * RAD),
    y: (p.lat - lat0) * RAD * R,
  }));
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i]!, b = xy[(i + 1) % xy.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  const area = Math.abs(sum) / 2 * 10.7639104167;
  return Number.isFinite(area) && area >= 1 ? Math.round(area) : null;
}
export function quoteCsv(spec: LawnSpec, quote: LawnQuote): string {
  const cell = (text: unknown) => {
    const str = String(text ?? '');
    // Disable spreadsheet formula execution for data entered by customers.
    const safe = /^[=+@\t\r\n]/.test(str) || /^-[^0-9]/.test(str) ? "'" + str : str;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const rows: (string | number)[][] = [
    ['Lawn care estimate', spec.customer],
    ['Property', spec.address],
    ['Frequency', SCHEDULE_LABELS[spec.schedule]],
    ['Measured area (ft2)', quote.netSqFt],
    ['Service', 'Quantity', 'Unit', 'Unit price (USD)', 'Amount (USD)'],
    ...quote.lines.map(l => [l.label, l.qty, l.unit, l.unitPrice, l.amount]),
    ['Subtotal', '', '', '', quote.subtotal],
    ['Tax (check local treatment)', '', '', '', quote.tax],
    ['Per visit', '', '', '', quote.perVisit],
    ['Monthly projection', '', '', '', quote.monthlyProjection],
    ['Annual projection', '', '', '', quote.annualProjection],
    ['Notes', spec.notes],
    ['Disclaimer', 'Preliminary quote. Verify site dimensions, obstacles and permit conditions.'],
  ];
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
