/** Electrical estimating core (Phase D, item 15).
 *
 * Load figures use simplified, editable planning assumptions (general lighting VA per
 * square foot, per-circuit allowances, a single demand factor). They are NOT an NEC
 * Article 220 load calculation and must never be presented as one for permitting;
 * final service sizing needs a code load calculation and local amendment check.
 *
 * Prices are contractor-entered only. A price of 0 means "not priced yet": the line keeps
 * its quantity, is flagged unpriced, and stays out of every total. Nothing is invented.
 */
export type ServiceType = 'new_service' | 'panel_upgrade' | 'branch_work_only';

export interface ElectricalSpec {
  customer: string;
  address: string;
  notes: string;
  dwellingSqFt: number;
  serviceType: ServiceType;
  panelAmps: number;
  /** Editable assumption: general lighting load, VA per sq ft. */
  lightingVaPerSqFt: number;
  /** Editable assumption: demand factor applied to the connected planning load (0-1). */
  demandFactor: number;
  generalCircuits: number;
  kitchenCircuits: number;
  bathroomCircuits: number;
  laundryCircuits: number;
  dedicatedCircuits: number;
  receptacles: number;
  switches: number;
  lightFixtures: number;
  wireRunFt: number;
  wastePercent: number;
  laborHours: number;
  laborRate: number;
  tripFee: number;
  taxPercent: number;
  /** Contractor-entered unit prices (USD). 0 = missing, never invented. */
  prices: {
    panelEach: number;
    breakerEach: number;
    receptacleEach: number;
    switchEach: number;
    fixtureEach: number;
    wirePerLinearFt: number;
  };
}

export const SERVICE_LABELS: Record<ServiceType, string> = {
  new_service: 'New service + panel',
  panel_upgrade: 'Panel upgrade (existing service)',
  branch_work_only: 'Branch circuits / devices only',
};

export const DEFAULT_ELECTRICAL: ElectricalSpec = {
  customer: '', address: '', notes: '',
  dwellingSqFt: 2000, serviceType: 'panel_upgrade', panelAmps: 200,
  lightingVaPerSqFt: 3, demandFactor: 0.8,
  generalCircuits: 8, kitchenCircuits: 2, bathroomCircuits: 2,
  laundryCircuits: 1, dedicatedCircuits: 3,
  receptacles: 40, switches: 25, lightFixtures: 20,
  wireRunFt: 800, wastePercent: 10,
  laborHours: 32, laborRate: 0, tripFee: 0, taxPercent: 0,
  prices: {
    panelEach: 0, breakerEach: 0, receptacleEach: 0,
    switchEach: 0, fixtureEach: 0, wirePerLinearFt: 0,
  },
};

export interface ElectricalLine {
  id: string; label: string; qty: number; unit: string;
  unitPrice: number | null; amount: number | null; detail: string;
}

export interface ElectricalQuote {
  lightingVa: number; connectedVa: number; demandVa: number; demandAmps: number;
  totalCircuits: number; wireWithWasteFt: number; lines: ElectricalLine[];
  pricedSubtotal: number; tax: number; total: number;
  unpricedCount: number; assumptions: string[];
}

/** Planning allowance per circuit type (VA). Editable via the demand factor only;
 * these are estimating allowances, not code values for a permit load calc. */
export const CIRCUIT_ALLOWANCE_VA = {
  general: 1200, kitchen: 1500, bathroom: 1200, laundry: 1500, dedicated: 2000,
} as const;

const moneyRound = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function safeNonnegative(value: unknown, max = 10_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, value));
}
const capped = (value: number, max: number) => safeNonnegative(value, max);
const count = (value: number, max = 10_000) => Math.round(capped(value, max));

export function computeElectricalQuote(spec: ElectricalSpec): ElectricalQuote {
  const sqFt = capped(spec.dwellingSqFt, 1_000_000);
  const vaPerSqFt = Math.min(10, Math.max(0, capped(spec.lightingVaPerSqFt, 10)));
  const demandFactor = Math.min(1, Math.max(0.1, capped(spec.demandFactor, 1) || 0.8));
  const lightingVa = Math.round(sqFt * vaPerSqFt);

  const circuits = {
    general: count(spec.generalCircuits, 500),
    kitchen: count(spec.kitchenCircuits, 100),
    bathroom: count(spec.bathroomCircuits, 100),
    laundry: count(spec.laundryCircuits, 50),
    dedicated: count(spec.dedicatedCircuits, 200),
  };
  const totalCircuits = circuits.general + circuits.kitchen + circuits.bathroom
    + circuits.laundry + circuits.dedicated;
  const circuitVa = circuits.general * CIRCUIT_ALLOWANCE_VA.general
    + circuits.kitchen * CIRCUIT_ALLOWANCE_VA.kitchen
    + circuits.bathroom * CIRCUIT_ALLOWANCE_VA.bathroom
    + circuits.laundry * CIRCUIT_ALLOWANCE_VA.laundry
    + circuits.dedicated * CIRCUIT_ALLOWANCE_VA.dedicated;
  const connectedVa = lightingVa + circuitVa;
  const demandVa = Math.round(connectedVa * demandFactor);
  const demandAmps = moneyRound(demandVa / 240);
  const waste = Math.min(50, capped(spec.wastePercent, 50));
  const wireWithWasteFt = moneyRound(capped(spec.wireRunFt, 1_000_000) * (1 + waste / 100));

  const lines: ElectricalLine[] = [];
  const add = (id: string, label: string, qty: number, unit: string,
    unitPrice: number, detail: string) => {
    if (qty <= 0 || !Number.isFinite(qty)) return;
    const price = capped(unitPrice, 10_000_000);
    lines.push({
      id, label, qty, unit,
      unitPrice: price > 0 ? price : null,
      amount: price > 0 ? moneyRound(qty * price) : null,
      detail,
    });
  };

  if (spec.serviceType !== 'branch_work_only') {
    add('panel', `${Math.round(capped(spec.panelAmps, 2000))}A panel`, 1, 'each',
      spec.prices.panelEach,
      `Planning demand ≈ ${demandAmps} A at 240 V (${demandVa.toLocaleString()} VA after ${demandFactor} demand factor); verify with a code load calculation`);
  }
  add('breakers', 'Branch breakers', totalCircuits, 'each', spec.prices.breakerEach,
    `${circuits.general} general, ${circuits.kitchen} kitchen, ${circuits.bathroom} bath, ${circuits.laundry} laundry, ${circuits.dedicated} dedicated`);
  add('receptacles', 'Receptacles', count(spec.receptacles), 'each',
    spec.prices.receptacleEach, 'Includes boxes/plates only if your unit price does; GFCI/AFCI locations need code check');
  add('switches', 'Switches', count(spec.switches), 'each', spec.prices.switchEach,
    'Single-pole allowance; 3-way/dimmer priced separately by contractor');
  add('fixtures', 'Light fixtures (install)', count(spec.lightFixtures), 'each',
    spec.prices.fixtureEach, 'Fixture supply included only if your unit price includes it');
  add('wire', 'Branch wire (with waste)', wireWithWasteFt, 'linear ft',
    spec.prices.wirePerLinearFt,
    `${capped(spec.wireRunFt, 1_000_000)} ft + ${waste}% waste; gauge mix per circuit design`);
  add('labor', 'Labor', capped(spec.laborHours, 10_000), 'crew hr', spec.laborRate,
    'Editable crew-time allowance');
  add('travel', 'Trip / mobilization fee', 1, 'visit', spec.tripFee,
    'Optional flat travel and equipment allowance');

  const pricedSubtotal = moneyRound(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0));
  const tax = moneyRound(pricedSubtotal * capped(spec.taxPercent, 100) / 100);
  return {
    lightingVa, connectedVa, demandVa, demandAmps, totalCircuits, wireWithWasteFt,
    lines, pricedSubtotal, tax, total: moneyRound(pricedSubtotal + tax),
    unpricedCount: lines.filter((l) => l.amount === null).length,
    assumptions: [
      `General lighting allowance: ${vaPerSqFt} VA/ft² (editable planning assumption).`,
      `Circuit allowances: general ${CIRCUIT_ALLOWANCE_VA.general} VA, kitchen ${CIRCUIT_ALLOWANCE_VA.kitchen} VA, bath ${CIRCUIT_ALLOWANCE_VA.bathroom} VA, laundry ${CIRCUIT_ALLOWANCE_VA.laundry} VA, dedicated ${CIRCUIT_ALLOWANCE_VA.dedicated} VA.`,
      `Single demand factor ${demandFactor} applied to the connected planning load at 240 V.`,
      'This is not an NEC Article 220 load calculation. Verify service size, GFCI/AFCI, and local amendments before permitting.',
      'Prices are contractor-entered. Lines without a price are excluded from totals.',
    ],
  };
}

export function electricalQuoteCsv(spec: ElectricalSpec, quote: ElectricalQuote): string {
  const cell = (text: unknown) => {
    const str = String(text ?? '');
    const safe = /^[=+@\t\r\n]/.test(str) || /^-[^0-9]/.test(str) ? "'" + str : str;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const rows: (string | number)[][] = [
    ['Electrical estimate (planning only, not a code load calculation)', spec.customer],
    ['Property', spec.address],
    ['Scope', SERVICE_LABELS[spec.serviceType]],
    ['Dwelling area (ft2)', spec.dwellingSqFt],
    ['Planning demand (VA)', quote.demandVa],
    ['Planning demand (amps at 240V)', quote.demandAmps],
    ['Item', 'Quantity', 'Unit', 'Unit price (USD)', 'Amount (USD)'],
    ...quote.lines.map((l) => [l.label, l.qty, l.unit,
      l.unitPrice ?? 'not priced', l.amount ?? 'not priced']),
    ['Priced subtotal', '', '', '', quote.pricedSubtotal],
    ['Tax (check local treatment)', '', '', '', quote.tax],
    ['Total (priced lines only)', '', '', '', quote.total],
    ['Unpriced lines', quote.unpricedCount],
    ['Notes', spec.notes],
    ['Disclaimer', 'Preliminary estimate. Verify with an NEC load calculation and local code before permitting.'],
  ];
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
